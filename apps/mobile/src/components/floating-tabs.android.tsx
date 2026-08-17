import { Host } from "@expo/ui";
import {
  HorizontalFloatingToolbar,
  Icon,
  IconToggleButton,
  useMaterialColors,
} from "@expo/ui/jetpack-compose";
import { router, usePathname } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { setBackgroundColorAsync } from "expo-system-ui";
import { useEffect } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import addIcon from "@/assets/icons/add.xml";
import homeIcon from "@/assets/icons/home.xml";
import inventoryIcon from "@/assets/icons/inventory.xml";
import settingsIcon from "@/assets/icons/settings.xml";
import { useAppColorScheme } from "@/theme/appearance";

type TabName = "home" | "products" | "settings";

function tabFromPath(pathname: string): TabName {
  if (pathname.startsWith("/products")) return "products";
  if (pathname.startsWith("/settings")) return "settings";
  return "home";
}

function FloatingTabBar() {
  const colorScheme = useAppColorScheme();
  const colors = useMaterialColors({ colorScheme });
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const selected = tabFromPath(pathname);

  if (pathname.endsWith("/new") || pathname.endsWith("/scan")) {
    return null;
  }

  const toggleColors = {
    checkedContainerColor: colors.secondaryContainer,
    checkedContentColor: colors.onSecondaryContainer,
    contentColor: colors.onSurfaceVariant,
  };

  return (
    <View
      pointerEvents="box-none"
      style={{
        alignItems: "center",
        bottom: 0,
        left: 0,
        paddingBottom: Math.max(insets.bottom, 12) + 8,
        position: "absolute",
        right: 0,
      }}
    >
      <Host colorScheme={colorScheme} key={colorScheme} matchContents>
        <HorizontalFloatingToolbar
          colors={{
            fabContainerColor: colors.primaryContainer,
            fabContentColor: colors.onPrimaryContainer,
            toolbarContainerColor: colors.surfaceContainerLowest,
            toolbarContentColor: colors.onSurfaceVariant,
          }}
          variant="vibrant"
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
          <HorizontalFloatingToolbar.FloatingActionButton
            onPress={() => router.navigate("/products/new")}
          >
            <Icon contentDescription="New product" source={addIcon} />
          </HorizontalFloatingToolbar.FloatingActionButton>
        </HorizontalFloatingToolbar>
      </Host>
    </View>
  );
}

export function FloatingTabs() {
  const colorScheme = useAppColorScheme();
  const colors = useMaterialColors({ colorScheme });

  useEffect(() => {
    void setBackgroundColorAsync(colors.surfaceContainer);
  }, [colors.surfaceContainer]);

  return (
    <View style={{ backgroundColor: colors.surfaceContainer, flex: 1 }}>
      <NativeTabs backgroundColor={colors.surfaceContainer} hidden>
        <NativeTabs.Trigger disableAutomaticContentInsets name="home">
          <NativeTabs.Trigger.Icon
            md={{ default: "home", selected: "home" }}
            sf={{ default: "house", selected: "house.fill" }}
          />
          <NativeTabs.Trigger.Label hidden>Home</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger disableAutomaticContentInsets name="products">
          <NativeTabs.Trigger.Icon
            md={{ default: "inventory_2", selected: "inventory_2" }}
            sf={{ default: "shippingbox", selected: "shippingbox.fill" }}
          />
          <NativeTabs.Trigger.Label hidden>Products</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger disableAutomaticContentInsets name="settings">
          <NativeTabs.Trigger.Icon
            md={{ default: "settings", selected: "settings" }}
            sf={{ default: "gearshape", selected: "gearshape.fill" }}
          />
          <NativeTabs.Trigger.Label hidden>Settings</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
      <FloatingTabBar />
    </View>
  );
}
