import { useLiveQuery } from "@tanstack/react-db";
import {
  createContext,
  type Context,
  type PropsWithChildren,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { authErrorMessage } from "@/lib/auth-client";
import { openMobileCatalog, type MobileInventoryCollections } from "@/lib/inventory-collections";
import { persistentDeviceId } from "@/lib/inventory-session";
import { snapshotFromRows } from "@/lib/inventory-snapshot";
import type {
  MobileBatch,
  MobileCategory,
  MobileProduct,
  SaveBatchDetailsInput,
  SaveScannedProductInput,
  UpdateBatchQuantityInput,
} from "@/lib/inventory-types";
import { createMobileCatalogActions } from "@/lib/mobile-catalog-actions";

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

const emptyData: ProductsData = { products: [], categories: [] };
const loadingStatus: ProductsStatus = { _tag: "Loading" };
const unavailableActions: ProductsActions = {
  refresh: async () => undefined,
  saveScannedProduct: async () => {
    throw new Error("This device is still opening its inventory.");
  },
  saveBatchDetails: async () => {
    throw new Error("This device is still opening its inventory.");
  },
  updateBatchQuantity: async () => {
    throw new Error("This device is still opening its inventory.");
  },
};

type ProductsProviderProps = PropsWithChildren<{
  userId: string;
  organizationId: string;
}>;

export function ProductsProvider(props: ProductsProviderProps) {
  return <ScopedProductsProvider key={props.organizationId} {...props} />;
}

function ScopedProductsProvider({ children, organizationId, userId }: ProductsProviderProps) {
  const [catalog, setCatalog] = useState<MobileInventoryCollections | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let opened: MobileInventoryCollections | undefined;
    void openMobileCatalog(organizationId)
      .then((next) => {
        opened = next;
        if (!cancelled) setCatalog(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setOpenError(authErrorMessage(cause));
      });
    return () => {
      cancelled = true;
      void opened?.dispose();
    };
  }, [organizationId]);

  if (!catalog) {
    return (
      <ProductsActionsContext value={unavailableActions}>
        <ProductsDataContext value={emptyData}>
          <ProductsStatusContext
            value={
              openError
                ? { _tag: "Error", error: openError, lastUpdatedAt: null, refreshing: false }
                : loadingStatus
            }
          >
            {children}
          </ProductsStatusContext>
        </ProductsDataContext>
      </ProductsActionsContext>
    );
  }

  return (
    <LiveProductsProvider catalog={catalog} organizationId={organizationId} userId={userId}>
      {children}
    </LiveProductsProvider>
  );
}

function LiveProductsProvider({
  children,
  catalog,
  organizationId,
  userId,
}: PropsWithChildren<{
  catalog: MobileInventoryCollections;
  organizationId: string;
  userId: string;
}>) {
  const categoriesQuery = useLiveQuery(catalog.categories);
  const productsQuery = useLiveQuery(catalog.products);
  const batchesQuery = useLiveQuery(catalog.batches);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const snapshot = useMemo(
    () =>
      snapshotFromRows({
        batches: batchesQuery.data.filter((batch) => batch.deletedAt === null),
        categories: categoriesQuery.data.filter((category) => category.deletedAt === null),
        products: productsQuery.data.filter((product) => product.deletedAt === null),
      }),
    [batchesQuery.data, categoriesQuery.data, productsQuery.data],
  );
  const hasCatalogRows = snapshot.categories.length > 0 || snapshot.products.length > 0;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      await Promise.all([
        catalog.categories.preload(),
        catalog.products.preload(),
        catalog.batches.preload(),
      ]);
      setLastUpdatedAt(new Date());
    } catch (cause) {
      if (!hasCatalogRows) setError(authErrorMessage(cause));
    } finally {
      setRefreshing(false);
    }
  }, [catalog, hasCatalogRows]);

  const catalogActions = useMemo(
    () =>
      deviceId ? createMobileCatalogActions(catalog, { organizationId, userId, deviceId }) : null,
    [catalog, deviceId, organizationId, userId],
  );

  const runWrite = useCallback(
    async <T,>(write: (actions: NonNullable<typeof catalogActions>) => Promise<T>) => {
      setError(null);
      try {
        if (!catalogActions) throw new Error("This device is still opening its inventory.");
        const result = await write(catalogActions);
        setLastUpdatedAt(new Date());
        return result;
      } catch (cause) {
        setError(authErrorMessage(cause));
        throw cause;
      }
    },
    [catalogActions],
  );

  const saveScannedProduct = useCallback(
    (input: SaveScannedProductInput) => runWrite((actions) => actions.saveScannedProduct(input)),
    [runWrite],
  );

  const saveBatchDetails = useCallback(
    (input: SaveBatchDetailsInput) => runWrite((actions) => actions.saveBatchDetails(input)),
    [runWrite],
  );

  const updateBatchQuantity = useCallback(
    (input: UpdateBatchQuantityInput) => runWrite((actions) => actions.updateBatchQuantity(input)),
    [runWrite],
  );

  useEffect(() => {
    void persistentDeviceId()
      .then(setDeviceId)
      .catch((cause: unknown) => {
        setError(authErrorMessage(cause));
      });
  }, []);

  useEffect(() => {
    const loading = categoriesQuery.isLoading || productsQuery.isLoading || batchesQuery.isLoading;
    if (!loading) setLastUpdatedAt(new Date());
  }, [
    batchesQuery.data,
    batchesQuery.isLoading,
    categoriesQuery.data,
    categoriesQuery.isLoading,
    productsQuery.data,
    productsQuery.isLoading,
  ]);

  const data = useMemo(
    () => ({ products: snapshot.products, categories: snapshot.categories }),
    [snapshot],
  );
  const status = useMemo((): ProductsStatus => {
    const loading =
      deviceId === null ||
      categoriesQuery.isLoading ||
      productsQuery.isLoading ||
      batchesQuery.isLoading;
    if (loading && !hasCatalogRows) return { _tag: "Loading" };
    const collectionFailed =
      categoriesQuery.isError || productsQuery.isError || batchesQuery.isError;
    if (error || collectionFailed) {
      return {
        _tag: "Error",
        error: error ?? "Inventory sync could not connect.",
        lastUpdatedAt,
        refreshing,
      };
    }
    return { _tag: "Ready", lastUpdatedAt, refreshing };
  }, [
    batchesQuery.isError,
    batchesQuery.isLoading,
    categoriesQuery.isError,
    categoriesQuery.isLoading,
    deviceId,
    error,
    hasCatalogRows,
    lastUpdatedAt,
    productsQuery.isError,
    productsQuery.isLoading,
    refreshing,
  ]);
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
