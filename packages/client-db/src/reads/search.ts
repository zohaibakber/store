import { MAX_PRODUCT_SEARCH_RESULTS } from "@store/contracts/replica";

export type SearchableProduct = {
  readonly id: string;
  readonly name: string;
  readonly composition: string | null;
  readonly strength: string | null;
};

const normalizeSearchText = (value: string | null) =>
  (value ?? "").toLowerCase().replace(/\s+/gu, " ").trim();

export const searchTokens = (query: string) => {
  const normalized = normalizeSearchText(query);
  return normalized ? normalized.split(" ") : [];
};

const startsAnyWord = (text: string, token: string) =>
  text.startsWith(token) || text.includes(` ${token}`);

const productSearchRank = (product: SearchableProduct, query: string): number | null => {
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

export const canonicalSearchLimit = (limit: number) =>
  Number.isFinite(limit)
    ? Math.min(MAX_PRODUCT_SEARCH_RESULTS, Math.max(1, Math.floor(limit)))
    : MAX_PRODUCT_SEARCH_RESULTS;

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
    .slice(0, canonicalSearchLimit(limit))
    .map((entry) => entry.product);
};

export const uniqueById = <Row extends { readonly id: string }>(
  rows: ReadonlyArray<Row>,
): ReadonlyArray<Row> => [...new Map(rows.map((row) => [row.id, row])).values()];
