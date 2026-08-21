import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Height of the floating action stack in `inventory-fabs`: 44 + 12 + 52. */
const ACTIONS_HEIGHT = 108;

const CLEARANCE = 24;

const MARGIN = 16;

/**
 * Height of a standard `UITabBar` above the home indicator. Pinned rather than
 * measured because `AppTabs` sets `minimizeBehavior="never"`, so the bar does
 * not change height while scrolling.
 */
const IOS_TAB_BAR = 49;

/**
 * Where the floating action stack sits, measured up from the bottom of the tab
 * screen's content area.
 *
 * The two platforms lay a native tab bar out differently, and that is the whole
 * reason this is a hook. iOS content extends *under* a translucent `UITabBar`,
 * so an overlay has to be lifted past it or it lands behind the bar. Android's
 * Material navigation bar is a sibling of the content, not a layer over it, so
 * the content area already stops where the bar begins and only a margin is
 * needed.
 */
export const useActionsInset = (): number => {
  const insets = useSafeAreaInsets();
  return Platform.OS === "android" ? MARGIN : IOS_TAB_BAR + insets.bottom + MARGIN;
};

export type Overlays = "nav" | "nav-and-actions";

/**
 * Bottom padding so a scroller's last row is not covered by something floating
 * over it.
 *
 * Not a hook, and deliberately so. The tab bar never appears in this sum. iOS
 * gives its first scroll view automatic content insets and Android sits the
 * content above the bar, so on both platforms the navigation is already paid
 * for by the platform. Only the actions we draw ourselves need budgeting, which
 * is why `"nav"` only adds that clearance.
 */
export const scrollInset = (overlays: Overlays): number =>
  (overlays === "nav-and-actions" ? ACTIONS_HEIGHT + MARGIN : 0) + CLEARANCE;
