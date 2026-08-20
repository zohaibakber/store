import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Height of the floating action stack in `inventory-fabs`: 44 + 12 + 52. */
const ACTIONS_HEIGHT = 108;

/** Space the bottom navigation occupies, measured up from the screen edge. */
const useBottomNav = (): number => {
  const insets = useSafeAreaInsets();
  return Platform.OS === "android"
    ? // The floating toolbar plus the margin it floats on.
      72 + Math.max(insets.bottom, 12) + 8
    : 49 + insets.bottom;
};

export type OverlayInsets = {
  /** Offset from the screen edge to the bottom of the floating action stack. */
  readonly actionsBottom: number;
  /** Bottom padding a scroller needs so its last row clears both overlays. */
  readonly scrollBottom: number;
};

/**
 * Where the floating actions sit, and how much room a scroller has to leave so
 * its last row is not stuck underneath them.
 */
export const useOverlayInsets = (): OverlayInsets => {
  const bottomNav = useBottomNav();

  return {
    actionsBottom: bottomNav + 16,
    // iOS scrollers already clear the native tab bar through
    // `contentInsetAdjustmentBehavior`, so only the actions need room. Android's
    // toolbar is an overlay we drew ourselves, so it does not.
    scrollBottom: (Platform.OS === "android" ? bottomNav : 0) + ACTIONS_HEIGHT + 24,
  };
};
