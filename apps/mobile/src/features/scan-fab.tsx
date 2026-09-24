import { ScanIcon } from "@hugeicons/core-free-icons";
import { useRouter } from "expo-router";
import * as React from "react";
import {
  Pressable,
  StyleSheet,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";

import { colors, motion, radius, space, touch } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";

const COLLAPSE_AFTER = 24;
const SCROLL_SLOP = 4;

export const SCAN_FAB_CLEARANCE = touch.primary + space[4] * 2;

export function useScanFabExtension() {
  const [extended, setExtended] = React.useState(true);
  const lastOffset = React.useRef(0);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.y;
    const delta = offset - lastOffset.current;
    lastOffset.current = offset;
    if (offset < COLLAPSE_AFTER || delta < -SCROLL_SLOP) setExtended(true);
    else if (delta > SCROLL_SLOP) setExtended(false);
  };
  return { extended, onScroll };
}

const layoutTransition = LinearTransition.duration(motion.quick);
const labelEntering = FadeIn.duration(motion.quick);
const labelExiting = FadeOut.duration(motion.quick);
const ripple = { color: "rgba(255,255,255,0.24)", foreground: true };

export function ScanFab({ extended }: { readonly extended: boolean }) {
  const { push } = useRouter();
  const openScan = () => push("/scan");
  const openBatchScan = () => push({ pathname: "/scan", params: { mode: "batch" } });
  return (
    <Animated.View layout={layoutTransition} style={styles.anchor}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Scan"
        accessibilityHint="Long press to scan a batch of packs"
        android_ripple={ripple}
        onLongPress={openBatchScan}
        onPress={openScan}
        style={extended ? styles.extended : styles.collapsed}
      >
        <Icon icon={ScanIcon} color={colors.ground} />
        {extended ? (
          <Animated.View entering={labelEntering} exiting={labelExiting}>
            <Text weight="medium" style={styles.label}>
              Scan
            </Text>
          </Animated.View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: "absolute",
    right: space[4],
    bottom: space[4],
    borderRadius: radius.lg,
    boxShadow: "0 3px 8px rgba(0, 0, 0, 0.18)",
  },
  extended: {
    height: touch.primary,
    minWidth: 80,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingLeft: space[4],
    paddingRight: space[4] + space[1],
    borderRadius: radius.lg,
    backgroundColor: colors.ink,
    overflow: "hidden",
  },
  collapsed: {
    height: touch.primary,
    width: touch.primary,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    backgroundColor: colors.ink,
    overflow: "hidden",
  },
  label: {
    color: colors.ground,
  },
});
