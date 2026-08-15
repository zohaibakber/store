import { BottomSheet, Button, Column, Host, Text } from "@expo/ui";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useUniwind } from "uniwind";

import { Button as TriggerButton, useThemeColor } from "@/components/mobile-ui";

export function AddInventoryActions() {
  const [presented, setPresented] = useState(false);
  const { theme } = useUniwind();
  const [foreground, muted] = useThemeColor(["foreground", "muted"]);

  const open = (href: "/products/new" | "/products/scan") => {
    setPresented(false);
    requestAnimationFrame(() => router.push(href));
  };

  return (
    <View>
      <TriggerButton size="sm" onPress={() => setPresented(true)}>
        Add product
      </TriggerButton>
      <Host colorScheme={theme === "dark" ? "dark" : "light"} matchContents seedColor="#525252">
        <BottomSheet
          isPresented={presented}
          onDismiss={() => setPresented(false)}
          showDragIndicator
        >
          <Column spacing={12} style={styles.sheet}>
            <Text textStyle={{ color: foreground, fontSize: 18, fontWeight: "500" }}>
              Add inventory
            </Text>
            <Text textStyle={{ color: muted, fontSize: 14, lineHeight: 20 }}>
              Enter product details or scan the label with the camera.
            </Text>
            <Button label="Create with form" onPress={() => open("/products/new")} />
            <Button
              label="Scan product"
              onPress={() => open("/products/scan")}
              variant="outlined"
            />
          </Column>
        </BottomSheet>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    height: 232,
    padding: 24,
  },
});
