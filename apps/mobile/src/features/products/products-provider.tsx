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
import type {
  MobileBatch,
  MobileCategory,
  MobileProduct,
  SaveBatchDetailsInput,
  SaveScannedProductInput,
  UpdateBatchQuantityInput,
} from "@/lib/inventory-types";
import { inventoryWorkspaceFactory, type InventoryWorkspace } from "@/lib/inventory-workspace";

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
  const workspaceRef = useRef<InventoryWorkspace | null>(null);
  const refreshInFlight = useRef<Promise<void> | null>(null);

  const ensureWorkspace = useCallback(async () => {
    const existing = workspaceRef.current;
    if (existing && existing.userId === userId) return existing;
    const workspace = await inventoryWorkspaceFactory.open(userId);
    workspaceRef.current = workspace;
    return workspace;
  }, [userId]);

  const refresh = useCallback(() => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const task = (async () => {
      setRefreshing(true);
      setError(null);
      try {
        const workspace = await ensureWorkspace();
        const snapshot = await workspace.synchronize();
        setProducts(snapshot.products);
        setCategories(snapshot.categories);
        setLastUpdatedAt(new Date());
      } catch (cause) {
        const snapshot = await ensureWorkspace()
          .then((workspace) => workspace.readSnapshot())
          .catch(() => null);
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
  }, [ensureWorkspace]);

  const refreshAfterWrite = useCallback(async () => {
    const workspace = await ensureWorkspace();
    const snapshot = await workspace.readSnapshot();
    setProducts(snapshot.products);
    setCategories(snapshot.categories);
    return snapshot;
  }, [ensureWorkspace]);

  const runWrite = useCallback(
    async <T,>(write: (workspace: InventoryWorkspace) => Promise<T>) => {
      setError(null);
      try {
        const workspace = await ensureWorkspace();
        const result = await write(workspace);
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
    [ensureWorkspace, refresh, refreshAfterWrite],
  );

  const saveScannedProduct = useCallback(
    (input: SaveScannedProductInput) =>
      runWrite((workspace) => workspace.saveScannedProduct(input)),
    [runWrite],
  );

  const saveBatchDetails = useCallback(
    (input: SaveBatchDetailsInput) => runWrite((workspace) => workspace.saveBatchDetails(input)),
    [runWrite],
  );

  const updateBatchQuantity = useCallback(
    (input: UpdateBatchQuantityInput) =>
      runWrite((workspace) => workspace.updateBatchQuantity(input)),
    [runWrite],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    workspaceRef.current = null;

    void inventoryWorkspaceFactory
      .open(userId)
      .then(async (workspace) => {
        if (!active) return;
        workspaceRef.current = workspace;
        const snapshot = await workspace.readSnapshot();
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
      workspaceRef.current = null;
      inventoryWorkspaceFactory.close();
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
