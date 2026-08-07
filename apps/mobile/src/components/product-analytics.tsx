import { Card } from "heroui-native/card";
import { Separator } from "heroui-native/separator";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { formatPrice, type MobileProduct } from "@/lib/products";

const LOW_STOCK_THRESHOLD = 10;

type ProductAnalyticsProps = { products: ReadonlyArray<MobileProduct> };

export function ProductAnalytics({ products }: ProductAnalyticsProps) {
  const [showValue, setShowValue] = useState(false);
  let outOfStock = 0;
  let lowStock = 0;
  let stockValue = 0;

  for (const product of products) {
    if (product.stock === 0) outOfStock += 1;
    else if (product.stock <= LOW_STOCK_THRESHOLD) lowStock += 1;
    stockValue += product.stock * (product.unitPrice ?? 0);
  }

  return (
    <Card variant="secondary">
      <Card.Body className="gap-4 p-4">
        <View className="flex-row items-stretch">
          <Metric label="Products" value={String(products.length)} />
          <Separator orientation="vertical" />
          <Metric
            label="Low stock"
            tone={lowStock > 0 ? "warning" : undefined}
            value={String(lowStock)}
          />
          <Separator orientation="vertical" />
          <Metric
            label="Out"
            tone={outOfStock > 0 ? "danger" : undefined}
            value={String(outOfStock)}
          />
        </View>
        <Separator />
        <Pressable
          accessibilityLabel={showValue ? "Hide stock value" : "Show stock value"}
          accessibilityRole="button"
          accessibilityState={{ expanded: showValue }}
          className="flex-row items-center justify-between gap-4"
          onPress={() => setShowValue((current) => !current)}
        >
          <View className="gap-0.5">
            <Text className="text-xs font-normal text-muted">Stock value</Text>
            <Text className="text-xs font-normal text-muted">
              {showValue ? "Tap to hide" : "Tap to reveal"}
            </Text>
          </View>
          <Text className="font-mono text-base text-foreground" numberOfLines={1}>
            {showValue ? formatPrice(stockValue) : "••••••"}
          </Text>
        </Pressable>
      </Card.Body>
    </Card>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger" | "warning";
}) {
  const valueClass =
    tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-foreground";

  return (
    <View className="flex-1 items-center gap-1 px-2">
      <Text className={`font-mono text-lg ${valueClass}`}>{value}</Text>
      <Text className="text-xs font-normal text-muted" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
