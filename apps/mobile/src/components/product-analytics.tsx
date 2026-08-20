import { useState } from "react";

import { Row, RowGroup, RowValue } from "@/components/ui/row";
import { inventoryOverview, LOW_STOCK_THRESHOLD } from "@/lib/product-catalog";
import { formatPrice, type MobileProduct } from "@/lib/products";

/**
 * What the inventory adds up to. Four rows in one group rather than four cards:
 * these are values to read down a column, not things to tap.
 *
 * Stock value starts hidden — it is the number you would not want a customer
 * reading over your shoulder.
 */
export function ProductAnalytics({
  products,
}: {
  readonly products: ReadonlyArray<MobileProduct>;
}) {
  const [valueShown, setValueShown] = useState(false);
  const overview = inventoryOverview(products);

  return (
    <RowGroup>
      <Row title="Products" trailing={<RowValue>{String(overview.count)}</RowValue>} />
      <Row
        supporting={`At or below ${LOW_STOCK_THRESHOLD} units`}
        title="Low stock"
        trailing={
          <RowValue tone={overview.lowStock > 0 ? "warning" : "muted"}>
            {String(overview.lowStock)}
          </RowValue>
        }
      />
      <Row
        title="Out of stock"
        trailing={
          <RowValue tone={overview.outOfStock > 0 ? "destructive" : "muted"}>
            {String(overview.outOfStock)}
          </RowValue>
        }
      />
      <Row
        onPress={() => setValueShown((shown) => !shown)}
        title="Stock value"
        trailing={
          <RowValue tone="default">
            {valueShown ? formatPrice(overview.stockValue) : "••••••"}
          </RowValue>
        }
      />
    </RowGroup>
  );
}
