import { StyleSheet, View } from "react-native";

import { InventoryFabs } from "@/components/inventory-fabs";
import { useOverlayInsets } from "@/hooks/use-overlay-insets";

/** Pins the inventory actions above whichever bottom navigation the platform draws. */
export function InventoryFabAnchor() {
  const { actionsBottom } = useOverlayInsets();

  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <View pointerEvents="box-none" style={[styles.anchor, { bottom: actionsBottom }]}>
        <InventoryFabs />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { position: "absolute", right: 16 },
  overlay: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
});
