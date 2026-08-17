import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InventoryFabs } from "@/components/inventory-fabs";

export function InventoryFabAnchor() {
  const insets = useSafeAreaInsets();

  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <View
        pointerEvents="box-none"
        style={[styles.anchor, { bottom: Math.max(insets.bottom, 16), right: 16 }]}
      >
        <InventoryFabs />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { position: "absolute" },
  overlay: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
});
