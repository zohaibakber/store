import { Host } from "@expo/ui";
import { HorizontalFloatingToolbar, Icon, IconButton } from "@expo/ui/jetpack-compose";
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";

import { useThemeColor } from "@/hooks/use-theme-color";
import { useAppColorScheme } from "@/theme/appearance";
import { colors } from "@/theme/colors";

type AddInventoryActionsProps = {
  onRefresh: () => void;
  refreshing: boolean;
};

export function AddInventoryActions({ onRefresh, refreshing }: AddInventoryActionsProps) {
  const colorScheme = useAppColorScheme();
  const [toolbarContainer, toolbarContent, fabContainer, fabContent] = useThemeColor([
    "surface-tertiary",
    "foreground",
    "accent",
    "accent-foreground",
  ]);

  return (
    <View pointerEvents="box-none" style={styles.positioner}>
      <Host colorScheme={colorScheme} matchContents seedColor={colors.systemBlue}>
        <HorizontalFloatingToolbar
          colors={{
            fabContainerColor: fabContainer,
            fabContentColor: fabContent,
            toolbarContainerColor: toolbarContainer,
            toolbarContentColor: toolbarContent,
          }}
          variant="standard"
        >
          <IconButton enabled={!refreshing} onClick={onRefresh}>
            <Icon
              contentDescription={refreshing ? "Refreshing inventory" : "Refresh inventory"}
              size={24}
              source={require("../assets/icons/refresh.xml")}
            />
          </IconButton>
          <IconButton onClick={() => router.push("/products/scan")}>
            <Icon
              contentDescription="Scan product label"
              size={24}
              source={require("../assets/icons/camera.xml")}
            />
          </IconButton>
          <HorizontalFloatingToolbar.FloatingActionButton
            onPress={() => router.push("/products/new")}
          >
            <Icon
              contentDescription="Create new product"
              size={24}
              source={require("../assets/icons/add.xml")}
            />
          </HorizontalFloatingToolbar.FloatingActionButton>
        </HorizontalFloatingToolbar>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  positioner: {
    alignItems: "center",
    bottom: 16,
    left: 16,
    position: "absolute",
    right: 16,
  },
});
