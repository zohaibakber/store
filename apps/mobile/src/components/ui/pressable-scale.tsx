import type { ReactNode } from "react";
import { useState } from "react";
import { Pressable, type StyleProp, type ViewStyle } from "react-native";
import Animated, { cubicBezier, useReducedMotion } from "react-native-reanimated";

const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);

type PressableScaleProps = {
  accessibilityLabel?: string;
  children: ReactNode;
  isDisabled?: boolean;
  /** Layout for the touch target itself, e.g. `flex: 1` inside a row. */
  layoutStyle?: StyleProp<ViewStyle>;
  onPress?: () => void;
  /** The visual box that scales on press. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Press feedback for anything tappable: 3% scale over 120ms as a CSS transition,
 * so nothing crosses to the JS thread. Reduced motion dims instead of scaling.
 */
export function PressableScale({
  accessibilityLabel,
  children,
  isDisabled,
  layoutStyle,
  onPress,
  style,
  testID,
}: PressableScaleProps) {
  const [pressed, setPressed] = useState(false);
  const reduced = useReducedMotion();
  const transition = {
    transitionDuration: "120ms",
    transitionProperty: reduced ? "opacity" : "transform",
    transitionTimingFunction: EASE_OUT,
  } as const;
  const feedback = reduced
    ? { opacity: pressed ? 0.72 : 1 }
    : { transform: [{ scale: pressed ? 0.97 : 1 }] };

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(isDisabled) }}
      disabled={isDisabled}
      hitSlop={8}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      pressRetentionOffset={16}
      style={layoutStyle}
      testID={testID}
    >
      <Animated.View style={[style, transition, isDisabled ? { opacity: 0.48 } : feedback]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
