import { ListItem, Text } from "@expo/ui";
import { useState } from "react";

import { AppList } from "@/components/app-list";
import { useThemeColor } from "@/hooks/use-theme-color";
import { formatPrice, type MobileProduct } from "@/lib/products";
import { cssColor } from "@/theme/colors";

const LOW_STOCK_THRESHOLD = 10;

type ProductAnalyticsProps = { products: ReadonlyArray<MobileProduct> };

export function ProductAnalytics({ products }: ProductAnalyticsProps) {
  const [showValue, setShowValue] = useState(false);
  let outOfStock = 0;
  let lowStock = 0;
  let stockValue = 0;
  const [muted, warning, danger] = useThemeColor(["muted", "warning", "danger"]);

  for (const product of products) {
    if (product.stock === 0) outOfStock += 1;
    else if (product.stock <= LOW_STOCK_THRESHOLD) lowStock += 1;
    stockValue += product.stock * (product.unitPrice ?? 0);
  }

  return (
    <AppList>
      <ListItem trailing={<Text>{String(products.length)}</Text>}>Products</ListItem>
      <ListItem trailing={<Text textStyle={{ color: cssColor(warning) }}>{String(lowStock)}</Text>}>
        Low stock
      </ListItem>
      <ListItem
        trailing={<Text textStyle={{ color: cssColor(danger) }}>{String(outOfStock)}</Text>}
      >
        Out of stock
      </ListItem>
      <ListItem
        onPress={() => setShowValue((current) => !current)}
        supportingText={showValue ? "Tap to hide" : "Tap to reveal"}
        trailing={
          <Text textStyle={{ color: cssColor(muted) }}>
            {showValue ? formatPrice(stockValue) : "••••••"}
          </Text>
        }
      >
        Stock value
      </ListItem>
    </AppList>
  );
}
