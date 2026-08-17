import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useThemeColor } from "@/hooks/use-theme-color";
import { cssColor } from "@/theme/colors";

export function InventoryFabs() {
  const [accent, onAccent] = useThemeColor(["accent", "accent-foreground"]);

  return (
    <View style={styles.stack}>
      <Pressable
        accessibilityLabel="Scan product"
        accessibilityRole="button"
        onPress={() => router.push("/products/scan")}
        style={({ pressed }) => [
          styles.small,
          { backgroundColor: accent, opacity: pressed ? 0.88 : 1 },
        ]}
      >
        <Image
          contentFit="contain"
          source="sf:camera"
          style={styles.icon}
          tintColor={cssColor(onAccent)}
        />
      </Pressable>
      <Pressable
        accessibilityLabel="New product"
        accessibilityRole="button"
        onPress={() => router.push("/products/new")}
        style={({ pressed }) => [
          styles.extended,
          { backgroundColor: accent, opacity: pressed ? 0.88 : 1 },
        ]}
      >
        <Image
          contentFit="contain"
          source="sf:plus"
          style={styles.icon}
          tintColor={cssColor(onAccent)}
        />
        <Text style={[styles.label, { color: onAccent }]}>New product</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  extended: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 16,
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.24)",
    flexDirection: "row",
    gap: 12,
    height: 56,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  icon: { height: 24, width: 24 },
  label: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20 },
  small: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 12,
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.24)",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  stack: { alignItems: "flex-end", gap: 16 },
});
