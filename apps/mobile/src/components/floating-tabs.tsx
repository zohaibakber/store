import { NativeTabs } from "expo-router/unstable-native-tabs";

import { useThemeColor } from "@/hooks/use-theme-color";

export function FloatingTabs() {
  const [background, foreground, muted, indicator] = useThemeColor([
    "surface",
    "foreground",
    "muted",
    "surface-tertiary",
  ]);

  return (
    <NativeTabs
      backgroundColor={background}
      backBehavior="history"
      iconColor={{ default: muted, selected: foreground }}
      indicatorColor={indicator}
      labelStyle={{
        default: { color: muted, fontFamily: "Inter_400Regular", fontSize: 12 },
        selected: { color: foreground, fontFamily: "Inter_500Medium", fontSize: 12 },
      }}
      labelVisibilityMode="labeled"
      minimizeBehavior="onScrollDown"
      rippleColor={indicator}
      shadowColor="transparent"
      tintColor={foreground}
    >
      <NativeTabs.Trigger name="home">
        <NativeTabs.Trigger.Icon
          md={{ default: "home", selected: "home" }}
          sf={{ default: "house", selected: "house.fill" }}
        />
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="products">
        <NativeTabs.Trigger.Icon
          md={{ default: "inventory_2", selected: "inventory_2" }}
          sf={{ default: "shippingbox", selected: "shippingbox.fill" }}
        />
        <NativeTabs.Trigger.Label>Products</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon
          md={{ default: "settings", selected: "settings" }}
          sf={{ default: "gearshape", selected: "gearshape.fill" }}
        />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
