import { formatCount } from "@/lib/format";
import type { CatalogCounts } from "@/lib/workspace-backup";

export const catalogContents = (counts: CatalogCounts) => {
  const products = formatCount(counts.products, "product");
  const sales = formatCount(counts.sales, "sale");
  return counts.purchaseOrders === 0
    ? `${products} and ${sales}`
    : `${products}, ${sales} and ${formatCount(counts.purchaseOrders, "purchase order")}`;
};
