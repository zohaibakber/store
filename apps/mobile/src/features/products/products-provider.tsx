import {
  createContext,
  type PropsWithChildren,
  use,
  useCallback,
  useEffect,
  useState,
} from "react";

import { authErrorMessage } from "@/lib/auth-client";
import { loadProducts, type MobileProduct } from "@/lib/products";

type RefreshKind = "initial" | "refresh";

type ProductsContextValue = {
  products: ReadonlyArray<MobileProduct>;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastUpdatedAt: Date | null;
  refresh: (kind?: RefreshKind) => Promise<void>;
};

const ProductsContext = createContext<ProductsContextValue | null>(null);

export function ProductsProvider({ children }: PropsWithChildren) {
  const [products, setProducts] = useState<ReadonlyArray<MobileProduct>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async (kind: RefreshKind = "refresh") => {
    if (kind === "initial") setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      setProducts(await loadProducts());
      setLastUpdatedAt(new Date());
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh("initial");
  }, [refresh]);

  return (
    <ProductsContext value={{ products, loading, refreshing, error, lastUpdatedAt, refresh }}>
      {children}
    </ProductsContext>
  );
}

export function useProducts() {
  const context = use(ProductsContext);
  if (!context) throw new Error("useProducts must be used within ProductsProvider.");
  return context;
}
