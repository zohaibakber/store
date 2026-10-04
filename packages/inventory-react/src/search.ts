import { searchTokens, type BatchRow, type CategoryRow, type ProductRow } from "@store/client-db";
import type { StockPolicy, StockStatus } from "@store/contracts";
import { MAX_SEARCH_QUERY_LENGTH } from "@store/contracts/replica";

export { matchCatalogProducts, type SearchableProduct } from "@store/client-db";

type StockBatch = Pick<BatchRow, "packQuantity" | "unitQuantity" | "expiresAt">;

export type ProductStockSummary = {
  readonly onHandUnits: number;
  readonly availableUnits: number;
  readonly expiredUnits: number;
  readonly status: Extract<StockStatus, "out" | "low" | "healthy">;
  readonly lowStock: boolean;
  readonly nearestExpiry: number | null;
};

export type CatalogProductSearchResult<Product = ProductRow> = {
  readonly product: Product;
  readonly stock: ProductStockSummary;
};

export const canonicalSearchQuery = (query: string) =>
  searchTokens(query.slice(0, MAX_SEARCH_QUERY_LENGTH)).join(" ");

export type ProductSearchStock = {
  readonly products: ReadonlyArray<ProductRow>;
  readonly categories: ReadonlyArray<CategoryRow>;
  readonly batches: ReadonlyArray<BatchRow>;
};

export const summarizeProductStock = (
  product: Pick<ProductRow, "unitsPerPack">,
  batches: Iterable<StockBatch>,
  policy: StockPolicy,
  now: number,
): ProductStockSummary => {
  let onHandUnits = 0;
  let availableUnits = 0;
  let nearestExpiry: number | null = null;
  for (const batch of batches) {
    const units = Math.max(0, batch.packQuantity * product.unitsPerPack + batch.unitQuantity);
    onHandUnits += units;
    if (batch.expiresAt !== null && batch.expiresAt <= now) continue;
    availableUnits += units;
    if (units > 0 && batch.expiresAt !== null) {
      nearestExpiry =
        nearestExpiry === null ? batch.expiresAt : Math.min(nearestExpiry, batch.expiresAt);
    }
  }
  const status: ProductStockSummary["status"] =
    availableUnits === 0 ? "out" : availableUnits <= policy.minimumUnits ? "low" : "healthy";
  return {
    onHandUnits,
    availableUnits,
    expiredUnits: onHandUnits - availableUnits,
    status,
    lowStock: status !== "healthy",
    nearestExpiry,
  };
};

export const catalogProductSearchResults = <
  Product extends Pick<ProductRow, "id" | "unitsPerPack">,
>(
  products: ReadonlyArray<Product>,
  batches: Iterable<StockBatch & Pick<BatchRow, "productId">>,
  policy: StockPolicy,
  now: number,
): ReadonlyArray<CatalogProductSearchResult<Product>> => {
  const batchesByProduct = new Map<string, Array<StockBatch>>();
  for (const batch of batches) {
    const group = batchesByProduct.get(batch.productId);
    if (group) group.push(batch);
    else batchesByProduct.set(batch.productId, [batch]);
  }
  return products.map((product) => ({
    product,
    stock: summarizeProductStock(product, batchesByProduct.get(product.id) ?? [], policy, now),
  }));
};
