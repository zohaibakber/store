import { Button, Host, Row } from "@expo/ui";
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useUniwind } from "uniwind";

import { useThemeColor } from "@/components/mobile-ui";

type AddInventoryActionsProps = {
  onRefresh: () => void;
  refreshing: boolean;
};

export function AddInventoryActions({ onRefresh, refreshing }: AddInventoryActionsProps) {
  const { theme } = useUniwind();
  const surface = useThemeColor("surface-tertiary");

  return (
    <View style={[styles.surface, { backgroundColor: surface }]}>
      <Host colorScheme={theme === "dark" ? "dark" : "light"} matchContents seedColor="#525252">
        <Row spacing={8}>
          <Button
            disabled={refreshing}
            label={refreshing ? "Refreshing…" : "Refresh"}
            onPress={onRefresh}
            variant="outlined"
          />
          <Button label="Scan" onPress={() => router.push("/products/scan")} variant="outlined" />
          <Button label="New product" onPress={() => router.push("/products/new")} />
        </Row>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { borderCurve: "continuous", borderRadius: 999, padding: 6 },
});
