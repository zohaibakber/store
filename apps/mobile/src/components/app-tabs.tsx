import { NativeTabs } from "expo-router/unstable-native-tabs";

import { useColors } from "@/theme/colors";
import { typography } from "@/theme/typography";

const isIOS = process.env.EXPO_OS === "ios";

/**
 * Native tabs from `expo-router`. One file for both platforms; only toolkit
 * differences diverge: iOS blur + hairline, Android opaque fill + indicator +
 * ripple.
 */
export function AppTabs() {
  const colors = useColors();

  // `lineHeight` is left off: the native bar lays the label out itself.
  const label = {
    color: colors.mutedForeground,
    fontFamily: typography.caption.fontFamily,
    fontSize: typography.caption.fontSize,
  };
  const selectedLabel = {
    ...label,
    color: colors.foreground,
    fontFamily: typography.label.fontFamily,
  };

  return (
    <NativeTabs
      backBehavior="history"
      // Left unset on iOS: an opaque fill would paint over the blur below.
      // Android has no blur material, so `card` fill is the equivalent.
      backgroundColor={isIOS ? undefined : colors.card}
      // Lets list content scroll visibly under the translucent bar.
      blurEffect="systemChromeMaterial"
      iconColor={{ default: colors.mutedForeground, selected: colors.foreground }}
      indicatorColor={colors.accent}
      labelStyle={{ default: label, selected: selectedLabel }}
      labelVisibilityMode="labeled"
      // Inventory FABs float at a fixed offset; a shrinking bar would strand them.
      minimizeBehavior="never"
      rippleColor={colors.accent}
      shadowColor={colors.border}
      tintColor={colors.foreground}
    >
      <NativeTabs.Trigger name="home">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        {/*
         * iOS swaps outline SF Symbol for filled twin; Material lacks filled
         * twins for two of these glyphs, so Android carries selection in the
         * indicator and icon colour.
         */}
        <NativeTabs.Trigger.Icon md="home" sf={{ default: "house", selected: "house.fill" }} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="products">
        <NativeTabs.Trigger.Label>Products</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          md="inventory_2"
          sf={{ default: "shippingbox", selected: "shippingbox.fill" }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          md="settings"
          sf={{ default: "gearshape", selected: "gearshape.fill" }}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
