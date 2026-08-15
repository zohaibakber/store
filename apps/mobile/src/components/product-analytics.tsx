import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Card } from "@/components/mobile-ui";
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
    <View className="gap-3">
      <View className="flex-row gap-2.5">
        <Metric label="Products" tone="blue" value={String(products.length)} />
        <Metric label="Low stock" tone="warning" value={String(lowStock)} />
        <Metric label="Out" tone="danger" value={String(outOfStock)} />
      </View>
      <Card variant="default">
        <Card.Body className="px-4 py-3.5">
          <Pressable
            accessibilityLabel={showValue ? "Hide stock value" : "Show stock value"}
            accessibilityRole="button"
            accessibilityState={{ expanded: showValue }}
            className="flex-row items-center justify-between gap-4"
            onPress={() => setShowValue((current) => !current)}
          >
            <View className="gap-0.5">
              <Text className="text-sm font-medium text-foreground">Stock value</Text>
              <Text className="text-xs text-muted">
                {showValue ? "Tap to hide" : "Tap to reveal"}
              </Text>
            </View>
            <Text className="font-mono text-base text-accent" numberOfLines={1}>
              {showValue ? formatPrice(stockValue) : "••••••"}
            </Text>
          </Pressable>
        </Card.Body>
      </Card>
    </View>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "blue" | "danger" | "warning";
}) {
  const valueClass =
    tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-blue";
  const backgroundClass =
    tone === "danger"
      ? "border-danger/15 bg-danger-soft"
      : tone === "warning"
        ? "border-warning/15 bg-warning-soft"
        : "border-blue/15 bg-blue-soft";

  return (
    <View className={`flex-1 gap-2 rounded-3xl border px-3 py-4 ${backgroundClass}`}>
      <Text className={`font-mono text-2xl ${valueClass}`}>{value}</Text>
      <Text className="text-foreground-secondary text-xs font-medium" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
