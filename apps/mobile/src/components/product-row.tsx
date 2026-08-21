import { StyleSheet, View } from "react-native";

import { Badge } from "@/components/ui/badge";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { useColors } from "@/theme/colors";
import { radius, size as sizes } from "@/theme/tokens";
import { typography } from "@/theme/typography";

type ProductRowProps = {
  readonly aisle: string | null;
  readonly category: string;
  readonly details: string;
  readonly name: string;
  readonly stock: number;
  readonly stockLabel: string;
  readonly unitPriceLabel: string;
  readonly visible: boolean;
  readonly onPress?: () => void;
};

/**
 * One catalog row. It takes primitives only — no product object, no context, no
 * queries — so `FlashList` can recycle it without re-rendering the whole page
 * as the user types. See `design-system.md` §6.
 */
export function ProductRow({
  aisle,
  category,
  details,
  name,
  stock,
  stockLabel,
  unitPriceLabel,
  visible,
  onPress,
}: ProductRowProps) {
  const colors = useColors();
  const supporting = [category, details, aisle ? `Aisle ${aisle}` : null]
    .filter(Boolean)
    .join(" · ");
  const stockTone = stock === 0 ? "destructive" : stock <= 10 ? "warning" : "muted";
  const label = `${name}, ${stockLabel}, ${unitPriceLabel}`;

  const body = (
    <>
      <View style={styles.row}>
        <View style={[styles.avatar, { backgroundColor: colors.secondary }]}>
          <Text style={styles.avatarText} tone="muted">
            {name.slice(0, 1).toLocaleUpperCase()}
          </Text>
        </View>
        <View style={styles.content}>
          <View style={styles.nameRow}>
            <Text numberOfLines={1} style={styles.name} variant="bodyMedium">
              {name}
            </Text>
            {visible ? null : <Badge>Hidden</Badge>}
          </View>
          {supporting ? (
            <Text numberOfLines={1} tone="muted" variant="caption">
              {supporting}
            </Text>
          ) : null}
        </View>
        <View style={styles.trailing}>
          <Text numberOfLines={1} selectable variant="mono">
            {unitPriceLabel}
          </Text>
          <Text numberOfLines={1} tone={stockTone} variant="caption">
            {stockLabel}
          </Text>
        </View>
      </View>
      <Separator inset={68} />
    </>
  );

  if (!onPress) {
    return <View accessibilityLabel={label}>{body}</View>;
  }

  return (
    <PressableScale
      accessibilityHint="Opens product details"
      accessibilityLabel={label}
      onPress={onPress}
    >
      {body}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: radius.md,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  avatarText: typography.bodyMedium,
  content: { flex: 1, gap: 2, minWidth: 0 },
  name: { flexShrink: 1 },
  nameRow: { alignItems: "center", flexDirection: "row", gap: 6 },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 16,
    minHeight: sizes.productRow,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  trailing: { alignItems: "flex-end", gap: 2, maxWidth: "36%" },
});
