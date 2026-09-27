import { CloudUploadIcon } from "@hugeicons/core-free-icons";
import * as React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, radius, space } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";

const PRODUCT_ROW_HEIGHT = 72;

const ripple = { color: colors.hairline };

export type ProductRowProps = {
  readonly id: string;
  readonly name: string;
  readonly subtitle: string;
  readonly onHandValue: string;
  readonly onHandUnit: string;
  readonly attention: string | null;
  readonly pending: boolean;
  readonly onOpen: (id: string) => void;
};

export const ProductRow = React.memo(function ProductRow({
  id,
  name,
  subtitle,
  onHandValue,
  onHandUnit,
  attention,
  pending,
  onOpen,
}: ProductRowProps) {
  const open = () => onOpen(id);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${onHandValue} ${onHandUnit}${attention ? `, ${attention}` : ""}${pending ? ", not synced yet" : ""}`}
      android_ripple={ripple}
      onPress={open}
      style={styles.row}
    >
      <View style={styles.body}>
        <Text size="base" numberOfLines={1}>
          {name}
        </Text>
        {subtitle.length > 0 ? (
          <Text size="xs" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {attention !== null || pending ? (
          <View style={styles.markers}>
            {attention !== null ? <AttentionMark label={attention} /> : null}
            {pending ? <PendingMark /> : null}
          </View>
        ) : null}
      </View>
      <View style={styles.trailing}>
        <Text size="base" weight="medium" tabular>
          {onHandValue}
        </Text>
        <Text size="xs" tone="muted" numberOfLines={1}>
          {onHandUnit}
        </Text>
      </View>
    </Pressable>
  );
});

export function AttentionMark({ label }: { readonly label: string }) {
  return (
    <View style={styles.attention}>
      <Text size="xs" weight="medium">
        {label}
      </Text>
    </View>
  );
}

function PendingMark() {
  return (
    <View style={styles.pending}>
      <Icon icon={CloudUploadIcon} size={14} color={colors.muted} />
      <Text size="xs" tone="muted">
        Not synced
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: PRODUCT_ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    backgroundColor: colors.ground,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  markers: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    marginTop: space[1],
  },
  attention: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.sm / 2,
    backgroundColor: colors.highlight,
  },
  pending: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
  },
  trailing: {
    alignItems: "flex-end",
    maxWidth: 120,
  },
});
