import { Host } from "@expo/ui";
import { HorizontalFloatingToolbar, Icon, IconToggleButton } from "@expo/ui/jetpack-compose";
import { router, usePathname } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { setBackgroundColorAsync } from "expo-system-ui";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import homeIcon from "@/assets/icons/home.xml";
import inventoryIcon from "@/assets/icons/inventory.xml";
import settingsIcon from "@/assets/icons/settings.xml";
import { useComposeTheme } from "@/theme/compose-colors";

type TabName = "home" | "products" | "settings";

const tabFromPath = (pathname: string): TabName => {
  if (pathname.startsWith("/products")) return "products";
  if (pathname.startsWith("/settings")) return "settings";
  return "home";
};

/**
 * Android keeps Material's floating toolbar — it is the platform's current
 * bottom-navigation shape — but takes its colours from the palette, so the
 * selected tab reads as `primary`/`accent` rather than a wallpaper tint.
 */
function FloatingTabBar() {
  const { scheme, seedColor, tokens } = useComposeTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const selected = tabFromPath(pathname);

  if (pathname.endsWith("/new") || pathname.endsWith("/scan")) return null;

  const toggleColors = {
    checkedContainerColor: tokens.primary,
    checkedContentColor: tokens.primaryForeground,
    contentColor: tokens.mutedForeground,
  };

  return (
    <View
      pointerEvents="box-none"
      style={[styles.anchor, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}
    >
      <Host colorScheme={scheme} key={scheme} matchContents seedColor={seedColor}>
        <HorizontalFloatingToolbar
          colors={{
            toolbarContainerColor: tokens.card,
            toolbarContentColor: tokens.mutedForeground,
          }}
          variant="standard"
        >
          <IconToggleButton
            checked={selected === "home"}
            colors={toggleColors}
            onCheckedChange={(checked) => {
              if (checked) router.navigate("/home");
            }}
          >
            <Icon contentDescription="Home" source={homeIcon} />
          </IconToggleButton>
          <IconToggleButton
            checked={selected === "products"}
            colors={toggleColors}
            onCheckedChange={(checked) => {
              if (checked) router.navigate("/products");
            }}
          >
            <Icon contentDescription="Products" source={inventoryIcon} />
          </IconToggleButton>
          <IconToggleButton
            checked={selected === "settings"}
            colors={toggleColors}
            onCheckedChange={(checked) => {
              if (checked) router.navigate("/settings");
            }}
          >
            <Icon contentDescription="Settings" source={settingsIcon} />
          </IconToggleButton>
        </HorizontalFloatingToolbar>
      </Host>
    </View>
  );
}

export function FloatingTabs() {
  const { tokens } = useComposeTheme();

  useEffect(() => {
    void setBackgroundColorAsync(tokens.background);
  }, [tokens.background]);

  return (
    <View style={{ backgroundColor: tokens.background, flex: 1 }}>
      <NativeTabs backgroundColor={tokens.background} hidden>
        <NativeTabs.Trigger disableAutomaticContentInsets name="home">
          <NativeTabs.Trigger.Icon md={{ default: "home", selected: "home" }} />
          <NativeTabs.Trigger.Label hidden>Home</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger disableAutomaticContentInsets name="products">
          <NativeTabs.Trigger.Icon md={{ default: "inventory_2", selected: "inventory_2" }} />
          <NativeTabs.Trigger.Label hidden>Products</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger disableAutomaticContentInsets name="settings">
          <NativeTabs.Trigger.Icon md={{ default: "settings", selected: "settings" }} />
          <NativeTabs.Trigger.Label hidden>Settings</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
      <FloatingTabBar />
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { alignItems: "center", bottom: 0, left: 0, position: "absolute", right: 0 },
});
