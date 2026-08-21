import { useState } from "react";

import { Row, RowGroup, RowValue } from "@/components/ui/row";
import { inventoryOverview, LOW_STOCK_THRESHOLD } from "@/lib/product-catalog";
import { formatPrice } from "@/lib/inventory-snapshot";
import type { MobileProduct } from "@/lib/inventory-types";

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
        accessibilityHint={valueShown ? "Hides the stock value" : "Reveals the stock value"}
        onPress={() => setValueShown((shown) => !shown)}
        title="Stock value"
        trailing={
          <RowValue label={valueShown ? undefined : "Hidden"} tone="default">
            {valueShown ? formatPrice(overview.stockValue) : "••••••"}
          </RowValue>
        }
      />
    </RowGroup>
  );
}
