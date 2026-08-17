import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Badge } from "@/components/ui/badge";
import { useThemeColor } from "@/hooks/use-theme-color";
import { formatPrice } from "@/lib/products";

type ProductRowProps = {
  name: string;
  category: string;
  details: string;
  aisle: string | null;
  stock: number;
  stockLabel: string;
  unitPrice: number | null;
  visible: boolean;
};

export const ProductRow = memo(function ProductRow({
  name,
  category,
  details,
  aisle,
  stock,
  stockLabel,
  unitPrice,
  visible,
}: ProductRowProps) {
  const secondary = [category, details, aisle ? `Aisle ${aisle}` : null]
    .filter(Boolean)
    .join(" · ");
  const [separator, foreground, muted, danger, warning, success] = useThemeColor([
    "separator",
    "foreground",
    "muted",
    "danger",
    "warning",
    "success",
  ]);
  const trailingColor = stock === 0 ? danger : stock <= 10 ? warning : success;

  return (
    <View
      accessibilityLabel={`${name}, ${stockLabel}, ${formatPrice(unitPrice)}`}
      style={styles.root}
    >
      <View style={styles.row}>
        <View style={[styles.avatar, { backgroundColor: separator }]}>
          <Text style={[styles.avatarText, { color: foreground }]}>
            {name.slice(0, 1).toLocaleUpperCase()}
          </Text>
        </View>
        <View style={styles.content}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: foreground }]} numberOfLines={1}>
              {name}
            </Text>
            {!visible ? <Badge>Hidden</Badge> : null}
          </View>
          {secondary ? (
            <Text style={[styles.secondary, { color: muted }]} numberOfLines={2}>
              {secondary}
            </Text>
          ) : null}
        </View>
        <View style={styles.trailing}>
          <Text selectable style={[styles.price, { color: foreground }]} numberOfLines={1}>
            {formatPrice(unitPrice)}
          </Text>
          <Text selectable style={[styles.stock, { color: trailingColor }]} numberOfLines={1}>
            {stockLabel}
          </Text>
        </View>
      </View>
      <View style={[styles.divider, { backgroundColor: separator }]} />
    </View>
  );
});

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  avatarText: { fontFamily: "Inter_500Medium", fontSize: 16 },
  content: { flex: 1, gap: 2, minWidth: 0 },
  divider: { height: StyleSheet.hairlineWidth, marginStart: 72 },
  name: { flexShrink: 1, fontFamily: "Inter_500Medium", fontSize: 16, lineHeight: 24 },
  nameRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  price: {
    fontFamily: "GeistMono_400Regular",
    fontSize: 14,
    fontVariant: ["tabular-nums"],
    lineHeight: 20,
  },
  root: { minHeight: 72 },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 16,
    minHeight: 72,
    paddingEnd: 16,
    paddingStart: 16,
    paddingVertical: 8,
  },
  secondary: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
  stock: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    lineHeight: 16,
  },
  trailing: { alignItems: "flex-end", gap: 4, maxWidth: "38%" },
});
