import type { CatalogCounts } from "@/host/workspace-backup";
import { formatCount } from "@/lib/format";

export const catalogContents = (counts: CatalogCounts) => {
  const products = formatCount(counts.products, "product");
  const sales = formatCount(counts.sales, "sale");
  return counts.purchaseOrders === 0
    ? `${products} and ${sales}`
    : `${products}, ${sales} and ${formatCount(counts.purchaseOrders, "purchase order")}`;
};
