import * as Network from "expo-network";
import {
  createContext,
  type Context,
  type PropsWithChildren,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

import { authErrorMessage, isOfflineCause } from "@/lib/auth-client";
import {
  inventorySnapshot,
  type MobileBatch,
  type MobileCategory,
  type MobileProduct,
  readCachedInventorySnapshot,
  saveBatchDetails as saveBatchDetailsMutation,
  type SaveBatchDetailsInput,
  saveScannedProduct as saveScannedProductMutation,
  type SaveScannedProductInput,
  updateBatchQuantity as updateBatchQuantityMutation,
  type UpdateBatchQuantityInput,
} from "@/lib/products";

type ProductsData = {
  products: ReadonlyArray<MobileProduct>;
  categories: ReadonlyArray<MobileCategory>;
};

type ProductsStatus =
  | { readonly _tag: "Loading" }
  | {
      readonly _tag: "Ready";
      readonly lastUpdatedAt: Date | null;
      readonly refreshing: boolean;
    }
  | {
      readonly _tag: "Error";
      readonly error: string;
      readonly lastUpdatedAt: Date | null;
      readonly refreshing: boolean;
    };

type ProductsActions = {
  refresh: () => Promise<void>;
  saveScannedProduct: (input: SaveScannedProductInput) => Promise<MobileProduct>;
  saveBatchDetails: (input: SaveBatchDetailsInput) => Promise<MobileBatch>;
  updateBatchQuantity: (input: UpdateBatchQuantityInput) => Promise<MobileBatch>;
};

const ProductsDataContext = createContext<ProductsData | null>(null);
const ProductsStatusContext = createContext<ProductsStatus | null>(null);
const ProductsActionsContext = createContext<ProductsActions | null>(null);

export function ProductsProvider({ children, userId }: PropsWithChildren<{ userId: string }>) {
  const [products, setProducts] = useState<ReadonlyArray<MobileProduct>>([]);
  const [categories, setCategories] = useState<ReadonlyArray<MobileCategory>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const refreshInFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(() => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const task = (async () => {
      setRefreshing(true);
      setError(null);
      try {
        const snapshot = await inventorySnapshot();
        setProducts(snapshot.products);
        setCategories(snapshot.categories);
        setLastUpdatedAt(new Date());
      } catch (cause) {
        const snapshot = await readCachedInventorySnapshot(userId).catch(() => null);
        if (snapshot) {
          setProducts(snapshot.products);
          setCategories(snapshot.categories);
        }
        if (!isOfflineCause(cause) || !snapshot) setError(authErrorMessage(cause));
      } finally {
        setRefreshing(false);
        refreshInFlight.current = null;
      }
    })();
    refreshInFlight.current = task;
    return task;
  }, [userId]);

  const refreshAfterWrite = useCallback(async () => {
    const snapshot = await readCachedInventorySnapshot(userId);
    setProducts(snapshot.products);
    setCategories(snapshot.categories);
    return snapshot;
  }, [userId]);

  const runWrite = useCallback(
    async <T,>(write: () => Promise<T>) => {
      setError(null);
      try {
        const result = await write();
        await refreshAfterWrite();
        const activeRefresh = refreshInFlight.current;
        if (activeRefresh) void activeRefresh.then(() => refresh());
        else void refresh();
        return result;
      } catch (cause) {
        setError(authErrorMessage(cause));
        throw cause;
      }
    },
    [refresh, refreshAfterWrite],
  );

  const saveScannedProduct = useCallback(
    (input: SaveScannedProductInput) => runWrite(() => saveScannedProductMutation(input)),
    [runWrite],
  );

  const saveBatchDetails = useCallback(
    (input: SaveBatchDetailsInput) => runWrite(() => saveBatchDetailsMutation(input)),
    [runWrite],
  );

  const updateBatchQuantity = useCallback(
    (input: UpdateBatchQuantityInput) => runWrite(() => updateBatchQuantityMutation(input)),
    [runWrite],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    void readCachedInventorySnapshot(userId)
      .then((snapshot) => {
        if (!active) return;
        setProducts(snapshot.products);
        setCategories(snapshot.categories);
      })
      .catch((cause: unknown) => {
        if (active) setError(authErrorMessage(cause));
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        void refresh();
      });
    return () => {
      active = false;
    };
  }, [refresh, userId]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => {
    let wasOnline: boolean | undefined;
    const subscription = Network.addNetworkStateListener((state) => {
      const isOnline = state.isConnected !== false && state.isInternetReachable !== false;
      const reconnected = wasOnline === false && isOnline;
      wasOnline = isOnline;
      if (reconnected) void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const data = useMemo(() => ({ products, categories }), [categories, products]);
  const status = useMemo((): ProductsStatus => {
    if (loading) return { _tag: "Loading" };
    if (error) return { _tag: "Error", error, lastUpdatedAt, refreshing };
    return { _tag: "Ready", lastUpdatedAt, refreshing };
  }, [error, lastUpdatedAt, loading, refreshing]);
  const actions = useMemo(
    () => ({ refresh, saveScannedProduct, saveBatchDetails, updateBatchQuantity }),
    [refresh, saveBatchDetails, saveScannedProduct, updateBatchQuantity],
  );

  return (
    <ProductsActionsContext value={actions}>
      <ProductsDataContext value={data}>
        <ProductsStatusContext value={status}>{children}</ProductsStatusContext>
      </ProductsDataContext>
    </ProductsActionsContext>
  );
}

const useRequiredContext = <T,>(context: Context<T | null>, name: string) => {
  const value = use(context);
  if (!value) throw new Error(`${name} must be used within ProductsProvider.`);
  return value;
};

export function useProductData() {
  return useRequiredContext(ProductsDataContext, "useProductData");
}

export function useProductStatus() {
  return useRequiredContext(ProductsStatusContext, "useProductStatus");
}

export const productStatusView = (status: ProductsStatus) => ({
  loading: status._tag === "Loading",
  refreshing: status._tag !== "Loading" && status.refreshing,
  error: status._tag === "Error" ? status.error : null,
  lastUpdatedAt: status._tag === "Loading" ? null : status.lastUpdatedAt,
});

export function useProductActions() {
  return useRequiredContext(ProductsActionsContext, "useProductActions");
}
