import { router } from "expo-router";
import { StyleSheet, View } from "react-native";

import { Icon } from "@/components/ui/icon";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { useColors } from "@/theme/colors";
import { radius } from "@/theme/tokens";

export function InventoryFabs() {
  const colors = useColors();

  return (
    <View style={styles.stack}>
      <PressableScale
        accessibilityLabel="Scan a product label"
        onPress={() => router.push("/products/scan")}
        style={[styles.scan, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <Icon name="camera" size={22} />
      </PressableScale>
      <PressableScale
        accessibilityLabel="New product"
        onPress={() => router.push("/products/new")}
        style={[styles.create, { backgroundColor: colors.primary }]}
      >
        <Icon color={colors.primaryForeground} name="plus" size={20} />
        <Text style={{ color: colors.primaryForeground }} variant="bodyMedium">
          New product
        </Text>
      </PressableScale>
    </View>
  );
}

const shadow = { boxShadow: "0 6px 16px rgba(0, 0, 0, 0.18)" } as const;

const styles = StyleSheet.create({
  create: {
    ...shadow,
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: radius.full,
    flexDirection: "row",
    gap: 8,
    height: 52,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  scan: {
    ...shadow,
    alignItems: "center",
    alignSelf: "flex-end",
    borderCurve: "continuous",
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  stack: { alignItems: "flex-end", gap: 12 },
});
