import * as React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, space } from "@/theme/tokens";
import { Text } from "@/ui/text";

const ripple = { color: colors.hairline };

export type InvoiceRowProps = {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly total: string;
  readonly onOpen: (id: string) => void;
};

export const InvoiceRow = React.memo(function InvoiceRow({
  id,
  title,
  subtitle,
  total,
  onOpen,
}: InvoiceRowProps) {
  const open = () => onOpen(id);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}, ${total}`}
      android_ripple={ripple}
      onPress={open}
      style={styles.row}
    >
      <View style={styles.body}>
        <Text size="base" numberOfLines={1}>
          {title}
        </Text>
        <Text size="xs" tone="muted" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Text size="base" weight="medium" tabular>
        {total}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    minHeight: 72,
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
});
