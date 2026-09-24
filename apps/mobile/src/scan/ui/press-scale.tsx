import type * as React from "react";
import { GestureDetector, useTapGesture } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { motion } from "@/theme/tokens";

type PressScaleProps = {
  readonly onPress: () => void;
  readonly enabled?: boolean;
  readonly accessibilityLabel: string;
  readonly style?: React.ComponentProps<typeof Animated.View>["style"];
  readonly children: React.ReactNode;
};

export function PressScale({
  onPress,
  enabled = true,
  accessibilityLabel,
  style,
  children,
}: PressScaleProps) {
  const pressed = useSharedValue(0);
  const tap = useTapGesture({
    enabled,
    onBegin: () => {
      "worklet";
      pressed.set(withTiming(1, { duration: motion.quick / 2 }));
    },
    onFinalize: () => {
      "worklet";
      pressed.set(withTiming(0, { duration: motion.quick }));
    },
    onActivate: () => {
      "worklet";
      scheduleOnRN(onPress);
    },
  });
  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pressed.get(), [0, 1], [1, 0.94]) }],
  }));
  return (
    <GestureDetector gesture={tap}>
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled: !enabled }}
        style={[style, animated]}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
