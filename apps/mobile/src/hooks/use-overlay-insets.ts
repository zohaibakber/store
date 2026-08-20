import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Height of the floating action stack in `inventory-fabs`: 44 + 12 + 52. */
const ACTIONS_HEIGHT = 108;

/** Breathing room between the last row and whatever floats over it. */
const CLEARANCE = 24;

/** Space the bottom navigation occupies, measured up from the screen edge. */
const useBottomNav = (): number => {
  const insets = useSafeAreaInsets();
  return Platform.OS === "android"
    ? // The floating toolbar plus the margin it floats on.
      72 + Math.max(insets.bottom, 12) + 8
    : 49 + insets.bottom;
};

/** Where the floating action stack sits, measured from the screen edge. */
export const useActionsInset = (): number => useBottomNav() + 16;

/** What floats over a scroller and therefore has to be scrolled clear of. */
export type Overlays = "nav" | "nav-and-actions";

/**
 * Bottom padding so a scroller's last row is not stranded under the bottom
 * navigation, or under the floating actions above it.
 *
 * iOS scrollers already clear the native tab bar themselves through
 * `contentInsetAdjustmentBehavior`, so the navigation costs nothing there.
 * Android's floating toolbar is an overlay we drew ourselves, so it does.
 */
export const useScrollInset = (overlays: Overlays): number => {
  const bottomNav = useBottomNav();
  const nav = Platform.OS === "android" ? bottomNav : 0;
  return nav + (overlays === "nav-and-actions" ? ACTIONS_HEIGHT : 0) + CLEARANCE;
};
