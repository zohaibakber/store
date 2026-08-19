import type { MobileProduct } from "@/lib/products";

export type StockFilter = "all" | "low" | "out" | "hidden";

export const STOCK_FILTERS: ReadonlyArray<{ value: StockFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "low", label: "Low stock" },
  { value: "out", label: "Out" },
  { value: "hidden", label: "Hidden" },
];

export const LOW_STOCK_THRESHOLD = 10;

export function filterCatalog(
  products: ReadonlyArray<MobileProduct>,
  query: string,
  filter: StockFilter,
): MobileProduct[] {
  const term = query.trim().toLocaleLowerCase();
  return products
    .filter((product) => {
      if (filter === "low" && (product.stock === 0 || product.stock > LOW_STOCK_THRESHOLD))
        return false;
      if (filter === "out" && product.stock !== 0) return false;
      if (filter === "hidden" && product.visible) return false;
      if (!term) return true;
      return [
        product.name,
        product.category,
        product.details,
        product.aisle,
        ...product.batches.map((batch) => batch.batchNumber),
      ]
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .some((value) => value.toLocaleLowerCase().includes(term));
    })
    .sort((left, right) => {
      if (!term) return left.name.localeCompare(right.name);
      const leftStarts = left.name.toLocaleLowerCase().startsWith(term);
      const rightStarts = right.name.toLocaleLowerCase().startsWith(term);
      return Number(rightStarts) - Number(leftStarts) || left.name.localeCompare(right.name);
    });
}

export function needsAttention(products: ReadonlyArray<MobileProduct>, limit = 4): MobileProduct[] {
  return products
    .filter((product) => product.stock <= LOW_STOCK_THRESHOLD)
    .sort((left, right) => left.stock - right.stock)
    .slice(0, limit);
}

export function inventoryOverview(products: ReadonlyArray<MobileProduct>) {
  let outOfStock = 0;
  let lowStock = 0;
  let stockValue = 0;
  for (const product of products) {
    if (product.stock === 0) outOfStock += 1;
    else if (product.stock <= LOW_STOCK_THRESHOLD) lowStock += 1;
    stockValue += product.stock * (product.unitPrice ?? 0);
  }
  return { outOfStock, lowStock, stockValue, count: products.length };
}

export function productSupportingText(product: MobileProduct) {
  return [product.category, product.details, product.aisle ? `Aisle ${product.aisle}` : null]
    .filter(Boolean)
    .join(" · ");
}
