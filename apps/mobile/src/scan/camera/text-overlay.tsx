import { StyleSheet, View } from "react-native";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { colors, motion, radius } from "@/theme/tokens";

import { type LiveTextFrame, MAX_LIVE_BLOCKS } from "./scan-camera";

type ViewSize = { readonly width: number; readonly height: number };

const SLOTS = Array.from({ length: MAX_LIVE_BLOCKS }, (_, index) => index);

function TextBox({
  index,
  frame,
  size,
}: {
  readonly index: number;
  readonly frame: SharedValue<LiveTextFrame>;
  readonly size: SharedValue<ViewSize>;
}) {
  const style = useAnimatedStyle(() => {
    const current = frame.get();
    const view = size.get();
    const block = current.blocks[index];
    if (block === undefined || current.width === 0 || view.width === 0) {
      return { opacity: withTiming(0, { duration: motion.quick }), width: 0, height: 0 };
    }
    const scale = Math.max(view.width / current.width, view.height / current.height);
    const offsetX = (view.width - current.width * scale) / 2;
    const offsetY = (view.height - current.height * scale) / 2;
    return {
      opacity: withTiming(1, { duration: motion.quick }),
      width: block.width * scale + 8,
      height: block.height * scale + 6,
      transform: [
        { translateX: offsetX + block.left * scale - 4 },
        { translateY: offsetY + block.top * scale - 3 },
      ],
    };
  });
  return <Animated.View style={[styles.box, style]} />;
}

export function TextOverlay({ frame }: { readonly frame: SharedValue<LiveTextFrame> }) {
  const size = useSharedValue<ViewSize>({ width: 0, height: 0 });
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(event) => {
        size.set({
          width: event.nativeEvent.layout.width,
          height: event.nativeEvent.layout.height,
        });
      }}
    >
      {SLOTS.map((index) => (
        <TextBox key={index} index={index} frame={frame} size={size} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: "absolute",
    left: 0,
    top: 0,
    borderWidth: 2,
    borderColor: colors.highlight,
    borderRadius: radius.sm / 2,
  },
});
