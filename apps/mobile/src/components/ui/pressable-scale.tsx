import type { ReactNode } from "react";
import { Pressable, type AccessibilityRole, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { disabledOpacity, motion } from "@/theme/tokens";

const timing = {
  duration: motion.pressMs,
  easing: Easing.bezier(...motion.easeOut),
} as const;

type PressableScaleProps = {
  readonly accessibilityHint?: string;
  readonly accessibilityLabel?: string;
  readonly accessibilityRole?: AccessibilityRole;
  readonly accessibilityState?: { readonly selected?: boolean };
  readonly children: ReactNode;
  readonly isDisabled?: boolean;
  /** Layout for the touch target itself, e.g. `flex: 1` inside a row. */
  readonly layoutStyle?: StyleProp<ViewStyle>;
  readonly onPress?: () => void;
  /** The visual box that scales on press. */
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
};

/**
 * Press feedback for anything tappable. The shared value holds the *state*
 * (pressed: 0 → 1) and the scale is interpolated from it, so a press never
 * crosses to the JS thread or triggers a render. Reduced motion dims instead of
 * scaling. See `design-system.md` §4.
 */
export function PressableScale({
  accessibilityHint,
  accessibilityLabel,
  accessibilityRole = "button",
  accessibilityState,
  children,
  isDisabled,
  layoutStyle,
  onPress,
  style,
  testID,
}: PressableScaleProps) {
  const pressed = useSharedValue(0);
  const reduced = useReducedMotion();

  const feedback = useAnimatedStyle(() => {
    const value = pressed.get();
    return reduced
      ? { opacity: interpolate(value, [0, 1], [1, motion.reducedOpacity]) }
      : { transform: [{ scale: interpolate(value, [0, 1], [1, motion.pressScale]) }] };
  });

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled: Boolean(isDisabled), ...accessibilityState }}
      disabled={isDisabled}
      hitSlop={8}
      onPress={onPress}
      onPressIn={() => pressed.set(withTiming(1, timing))}
      onPressOut={() => pressed.set(withTiming(0, timing))}
      pressRetentionOffset={16}
      style={layoutStyle}
      testID={testID}
    >
      <Animated.View style={[style, isDisabled ? { opacity: disabledOpacity } : feedback]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
