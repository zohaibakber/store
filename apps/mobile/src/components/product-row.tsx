import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Badge, useThemeColor } from "@/components/mobile-ui";
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
  const stockColor = stock === 0 ? "danger" : stock <= 10 ? "warning" : "success";
  const secondary = [details, aisle ? `Aisle ${aisle}` : null].filter(Boolean).join(" · ");
  const [surface, subtle, border, foreground, muted] = useThemeColor([
    "surface",
    "surface-tertiary",
    "separator",
    "foreground",
    "muted",
  ]);

  return (
    <View
      accessibilityLabel={`${name}, ${stockLabel}, ${formatPrice(unitPrice)}`}
      style={[styles.root, { backgroundColor: surface, borderColor: border }]}
    >
      <View style={[styles.avatar, { backgroundColor: subtle }]}>
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
        <Text style={[styles.secondary, { color: muted }]} numberOfLines={1}>
          {category}
        </Text>
        {secondary ? (
          <Text style={[styles.secondary, { color: muted }]} numberOfLines={1}>
            {secondary}
          </Text>
        ) : null}
      </View>
      <View style={styles.trailing}>
        <Text style={[styles.price, { color: foreground }]} numberOfLines={1}>
          {formatPrice(unitPrice)}
        </Text>
        <Badge tone={stockColor}>{stockLabel}</Badge>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 10,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  avatarText: { fontFamily: "Inter_500Medium", fontSize: 16 },
  content: { flex: 1, gap: 4, minWidth: 0 },
  name: { flexShrink: 1, fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20 },
  nameRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  price: { fontFamily: "GeistMono_400Regular", fontSize: 14, lineHeight: 20 },
  root: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    marginBottom: 8,
    padding: 12,
  },
  secondary: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 16 },
  trailing: { alignItems: "flex-end", gap: 8, maxWidth: "38%" },
});
