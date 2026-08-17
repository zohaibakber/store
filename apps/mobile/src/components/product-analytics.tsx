import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/ui/card";
import { useThemeColor } from "@/hooks/use-theme-color";
import { formatPrice, type MobileProduct } from "@/lib/products";

const LOW_STOCK_THRESHOLD = 10;

type ProductAnalyticsProps = { products: ReadonlyArray<MobileProduct> };

export function ProductAnalytics({ products }: ProductAnalyticsProps) {
  const [showValue, setShowValue] = useState(false);
  let outOfStock = 0;
  let lowStock = 0;
  let stockValue = 0;
  const [foreground, muted] = useThemeColor(["foreground", "muted"]);

  for (const product of products) {
    if (product.stock === 0) outOfStock += 1;
    else if (product.stock <= LOW_STOCK_THRESHOLD) lowStock += 1;
    stockValue += product.stock * (product.unitPrice ?? 0);
  }

  return (
    <View style={styles.root}>
      <View style={styles.metrics}>
        <Metric label="Products" tone="default" value={String(products.length)} />
        <Metric label="Low stock" tone="warning" value={String(lowStock)} />
        <Metric label="Out" tone="danger" value={String(outOfStock)} />
      </View>
      <Card variant="default">
        <Card.Body style={styles.valueBody}>
          <Pressable
            accessibilityLabel={showValue ? "Hide stock value" : "Show stock value"}
            accessibilityRole="button"
            accessibilityState={{ expanded: showValue }}
            onPress={() => setShowValue((current) => !current)}
            style={({ pressed }) => [styles.valueRow, { opacity: pressed ? 0.64 : 1 }]}
          >
            <View style={styles.valueCopy}>
              <Text style={[styles.label, { color: foreground }]}>Stock value</Text>
              <Text style={[styles.caption, { color: muted }]}>
                {showValue ? "Tap to hide" : "Tap to reveal"}
              </Text>
            </View>
            <Text selectable style={[styles.stockValue, { color: foreground }]} numberOfLines={1}>
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
  tone: "default" | "danger" | "warning";
}) {
  const [surface, border, foreground, muted, danger, warning] = useThemeColor([
    "surface-secondary",
    "separator",
    "foreground",
    "muted",
    "danger",
    "warning",
  ]);
  const valueColor = tone === "danger" ? danger : tone === "warning" ? warning : foreground;

  return (
    <View style={[styles.metric, { backgroundColor: surface, borderColor: border }]}>
      <Text selectable style={[styles.metricValue, { color: valueColor }]}>
        {value}
      </Text>
      <Text style={[styles.metricLabel, { color: muted }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  caption: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 16 },
  label: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20 },
  metric: {
    borderCurve: "continuous",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 16,
  },
  metricLabel: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 16 },
  metrics: { flexDirection: "row", gap: 8 },
  metricValue: {
    fontFamily: "GeistMono_400Regular",
    fontSize: 24,
    fontVariant: ["tabular-nums"],
    lineHeight: 28,
  },
  root: { gap: 12 },
  stockValue: {
    fontFamily: "GeistMono_400Regular",
    fontSize: 16,
    fontVariant: ["tabular-nums"],
    lineHeight: 22,
  },
  valueBody: { paddingHorizontal: 16, paddingVertical: 14 },
  valueCopy: { gap: 2 },
  valueRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 16,
    justifyContent: "space-between",
  },
});
