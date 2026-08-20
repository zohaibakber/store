import { NativeTabs } from "expo-router/unstable-native-tabs";

import { useColors } from "@/theme/colors";
import { typography } from "@/theme/typography";

const isIOS = process.env.EXPO_OS === "ios";

/**
 * The bottom navigation: a real `UITabBar` on iOS and a Material navigation bar
 * on Android, both from `expo-router`'s native tabs. Native structure, our
 * paint — see `design-system.md` §5.
 *
 * One file for both platforms. The tab bar is the platform's, so the only
 * per-platform values are the ones the two toolkits genuinely do differently:
 * iOS gets a blur material and a hairline, Android gets an opaque fill, a
 * selection indicator and a ripple.
 */
export function AppTabs() {
  const colors = useColors();

  const label = { fontFamily: typography.caption.fontFamily, fontSize: 12 } as const;
  const selectedLabel = { ...label, fontFamily: typography.label.fontFamily };

  return (
    <NativeTabs
      backBehavior="history"
      // Left unset on iOS: an opaque fill would paint over the blur below and
      // content would stop showing through the bar. Android has no blur
      // material, so there the `card` fill is the equivalent.
      backgroundColor={isIOS ? undefined : colors.card}
      // A translucency rather than a hue, so it adds no colour the palette
      // didn't choose — and it is what lets a list scroll visibly under the bar.
      blurEffect="systemChromeMaterial"
      iconColor={{ default: colors.mutedForeground, selected: colors.foreground }}
      indicatorColor={colors.accent}
      labelStyle={{
        default: { ...label, color: colors.mutedForeground },
        selected: { ...selectedLabel, color: colors.foreground },
      }}
      labelVisibilityMode="labeled"
      // The bar's height has to stay put: the inventory actions float at a
      // fixed offset above it, and a bar that shrinks mid-scroll would leave
      // them hanging. See `use-overlay-insets`.
      minimizeBehavior="never"
      rippleColor={colors.accent}
      // The line between bar and content is a border, not an elevation shadow.
      shadowColor={colors.border}
      tintColor={colors.foreground}
    >
      <NativeTabs.Trigger name="home">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        {/*
         * Each platform signals selection its own way. iOS swaps the outline
         * symbol for its filled twin; Material has no filled twin for two of
         * these three glyphs, so Android carries selection in the indicator and
         * the icon colour, which is how Material says it anyway.
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
