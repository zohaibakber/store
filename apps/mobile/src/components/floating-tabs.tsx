import { NativeTabs } from "expo-router/unstable-native-tabs";

import { useColors } from "@/theme/colors";
import { typography } from "@/theme/typography";

/**
 * The platform tab bar, painted from the palette: `card` bar, `mutedForeground`
 * → `foreground` on selection, `accent` indicator. No platform tint, no shadow.
 */
export function FloatingTabs() {
  const colors = useColors();
  const label = { fontFamily: typography.caption.fontFamily, fontSize: 12 } as const;

  return (
    <NativeTabs
      backBehavior="history"
      backgroundColor={colors.card}
      iconColor={{ default: colors.mutedForeground, selected: colors.foreground }}
      indicatorColor={colors.accent}
      labelStyle={{
        default: { ...label, color: colors.mutedForeground },
        selected: { ...label, color: colors.foreground, fontFamily: typography.label.fontFamily },
      }}
      labelVisibilityMode="labeled"
      minimizeBehavior="onScrollDown"
      rippleColor={colors.accent}
      shadowColor="transparent"
      tintColor={colors.foreground}
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
