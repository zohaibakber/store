import {
  createContext,
  type PropsWithChildren,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

import { authErrorMessage } from "@/lib/auth-client";
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

type ProductsContextValue = {
  products: ReadonlyArray<MobileProduct>;
  categories: ReadonlyArray<MobileCategory>;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastUpdatedAt: Date | null;
  refresh: () => Promise<void>;
  saveScannedProduct: (input: SaveScannedProductInput) => Promise<MobileProduct>;
  saveBatchDetails: (input: SaveBatchDetailsInput) => Promise<MobileBatch>;
  updateBatchQuantity: (input: UpdateBatchQuantityInput) => Promise<MobileBatch>;
};

const ProductsContext = createContext<ProductsContextValue | null>(null);

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
        setError(authErrorMessage(cause));
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

  return (
    <ProductsContext
      value={{
        products,
        categories,
        loading,
        refreshing,
        error,
        lastUpdatedAt,
        refresh,
        saveScannedProduct,
        saveBatchDetails,
        updateBatchQuantity,
      }}
    >
      {children}
    </ProductsContext>
  );
}

export function useProducts() {
  const context = use(ProductsContext);
  if (!context) throw new Error("useProducts must be used within ProductsProvider.");
  return context;
}
