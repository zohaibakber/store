import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View, type ColorValue } from "react-native";

import { useThemeColor } from "@/hooks/use-theme-color";

type AddInventoryActionsProps = {
  onRefresh: () => void;
  refreshing: boolean;
};

export function AddInventoryActions({ onRefresh, refreshing }: AddInventoryActionsProps) {
  const [surface, foreground, accent, onAccent] = useThemeColor([
    "surface-tertiary",
    "foreground",
    "accent",
    "accent-foreground",
  ]);

  return (
    <View style={[styles.surface, { backgroundColor: surface }]}>
      <ActionButton
        disabled={refreshing}
        label={refreshing ? "Refreshing…" : "Refresh"}
        onPress={onRefresh}
        textColor={foreground}
      />
      <ActionButton label="Scan" onPress={() => router.push("/products/scan")} textColor={foreground} />
      <ActionButton
        backgroundColor={accent}
        label="New product"
        onPress={() => router.push("/products/new")}
        textColor={onAccent}
      />
    </View>
  );
}

function ActionButton({
  backgroundColor,
  disabled,
  label,
  onPress,
  textColor,
}: {
  backgroundColor?: ColorValue;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  textColor: ColorValue;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        backgroundColor ? { backgroundColor } : null,
        { opacity: disabled ? 0.48 : pressed ? 0.72 : 1 },
      ]}
    >
      <Text style={[styles.label, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 999,
    height: 40,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  label: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 16 },
  surface: {
    borderCurve: "continuous",
    borderRadius: 999,
    flexDirection: "row",
    gap: 8,
    padding: 6,
  },
});
