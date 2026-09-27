import {
  decodeProductSqliteRows,
  DEFAULT_COLLECTION_MAXIMUM_ROWS,
  type BatchRow,
  type InventorySubsetSpec,
  type ProductRow,
  type ReplicaSubsetReader,
  type SubsetPredicate,
} from "@store/client-db";
import type { StockPolicy, StockStatus } from "@store/services/stock-recommendations";
import * as Effect from "effect/Effect";

export const MAX_PRODUCT_SEARCH_RESULTS = 200;

const MAX_SEARCH_QUERY_LENGTH = 120;

const SEARCH_CANDIDATES_PER_RESULT = 4;

const SEARCH_COLUMNS = ["name", "composition", "strength"] as const;

export type SearchableProduct = {
  readonly id: string;
  readonly name: string;
  readonly composition: string | null;
  readonly strength: string | null;
};

export type StockBatch = Pick<BatchRow, "packQuantity" | "unitQuantity" | "expiresAt">;

export type ProductStockSummary = {
  readonly onHandUnits: number;
  readonly availableUnits: number;
  readonly expiredUnits: number;
  readonly status: StockStatus;
  readonly lowStock: boolean;
  readonly nearestExpiry: number | null;
};

export type CatalogProductSearchResult<Product = ProductRow> = {
  readonly product: Product;
  readonly stock: ProductStockSummary;
};

const normalizeSearchText = (value: string | null) =>
  (value ?? "").toLowerCase().replace(/\s+/gu, " ").trim();

const searchTokens = (query: string) => {
  const normalized = normalizeSearchText(query);
  return normalized ? normalized.split(" ") : [];
};

const startsAnyWord = (text: string, token: string) =>
  text.startsWith(token) || text.includes(` ${token}`);

export const productSearchRank = (product: SearchableProduct, query: string): number | null => {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return 0;
  const name = normalizeSearchText(product.name);
  const details = `${normalizeSearchText(product.composition)} ${normalizeSearchText(product.strength)}`;
  const everything = `${name} ${details}`;
  if (!tokens.every((token) => everything.includes(token))) return null;
  const phrase = tokens.join(" ");
  if (name.startsWith(phrase)) return 0;
  if (tokens.every((token) => startsAnyWord(name, token))) return 1;
  if (name.includes(phrase)) return 2;
  if (tokens.every((token) => startsAnyWord(everything, token))) return 3;
  return 4;
};

const clampLimit = (limit: number) =>
  Number.isFinite(limit)
    ? Math.min(MAX_PRODUCT_SEARCH_RESULTS, Math.max(1, Math.floor(limit)))
    : MAX_PRODUCT_SEARCH_RESULTS;

const BY_NAME: InventorySubsetSpec["orderBy"] = [{ column: "name", direction: "asc" }];

const containsToken = (token: string): SubsetPredicate => ({
  _tag: "or",
  predicates: SEARCH_COLUMNS.map((column) => ({ _tag: "like", column, pattern: `%${token}%` })),
});

export const productSearchSpecs = (
  query: string,
  limit: number,
): ReadonlyArray<InventorySubsetSpec> => {
  const bounded = clampLimit(limit);
  const tokens = searchTokens(query.slice(0, MAX_SEARCH_QUERY_LENGTH));
  if (tokens.length === 0) {
    return [{ source: "products", orderBy: BY_NAME, limit: bounded, offset: 0 }];
  }
  return [
    {
      source: "products",
      where: { _tag: "like", column: "name", pattern: `${tokens.join(" ")}%` },
      orderBy: BY_NAME,
      limit: bounded,
      offset: 0,
    },
    {
      source: "products",
      where: { _tag: "and", predicates: tokens.map(containsToken) },
      orderBy: BY_NAME,
      limit: Math.min(DEFAULT_COLLECTION_MAXIMUM_ROWS, bounded * SEARCH_CANDIDATES_PER_RESULT),
      offset: 0,
    },
  ];
};

export const matchCatalogProducts = <Product extends SearchableProduct>(
  products: Iterable<Product>,
  query: string,
  limit: number,
): ReadonlyArray<Product> => {
  const ranked: Array<{ readonly product: Product; readonly rank: number }> = [];
  for (const product of products) {
    const rank = productSearchRank(product, query);
    if (rank !== null) ranked.push({ product, rank });
  }
  return ranked
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.product.name.localeCompare(right.product.name) ||
        left.product.id.localeCompare(right.product.id),
    )
    .slice(0, clampLimit(limit))
    .map((entry) => entry.product);
};

export type ProductSearchFailure = { readonly message: string };

const searchFailure = (): ProductSearchFailure => ({
  message: "Could not search products on this device.",
});

const uniqueProducts = (products: ReadonlyArray<ProductRow>): ReadonlyArray<ProductRow> => [
  ...new Map(products.map((product) => [product.id, product])).values(),
];

export const searchCatalogProducts = (
  reader: ReplicaSubsetReader,
  query: string,
  limit: number,
): Effect.Effect<ReadonlyArray<ProductRow>, ProductSearchFailure> =>
  Effect.forEach(productSearchSpecs(query, limit), (spec) =>
    Effect.tryPromise({ try: () => reader.readSubset(spec), catch: searchFailure }).pipe(
      Effect.flatMap((read) => decodeProductSqliteRows(read.rows)),
      Effect.mapError(searchFailure),
    ),
  ).pipe(
    Effect.map((reads) => matchCatalogProducts(uniqueProducts(reads.flat()), query, limit)),
    Effect.withSpan("InventorySearch.searchCatalogProducts"),
  );

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
  const status: StockStatus =
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
