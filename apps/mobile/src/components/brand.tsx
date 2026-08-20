import { StyleSheet, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { Text } from "@/components/ui/text";
import { useColors } from "@/theme/colors";
import { radius } from "@/theme/tokens";

const name = __DEV__ ? "Tabaaq Dev" : "Tabaaq";

/**
 * The wordmark. The mark is `foreground` with `background` cut out of it, so it
 * inverts with the appearance and never introduces a brand hue — the product's
 * colour is neutral. See `design-system.md` §1.
 */
export function Brand() {
  const colors = useColors();

  return (
    <View style={styles.root}>
      <Svg accessibilityLabel={name} height={28} viewBox="0 0 832 832" width={28}>
        <Rect fill={colors.foreground} height={832} rx={192} width={832} />
        <Rect fill={colors.background} height={132} rx={44} width={500} x={166} y={182} />
        <Rect fill={colors.background} height={364} rx={44} width={132} x={350} y={286} />
        <Rect fill={colors.background} height={132} rx={42} width={132} x={514} y={350} />
        <Path
          d="M580 382v68M546 416h68"
          stroke={colors.foreground}
          strokeLinecap="round"
          strokeWidth={22}
        />
        <Circle cx={615} cy={217} fill={colors.foreground} r={25} />
      </Svg>
      <Text variant="heading">{name}</Text>
    </View>
  );
}

/** The mark on its own, for a row's leading slot. */
export function BrandMark({ size = 32 }: { readonly size?: number }) {
  const colors = useColors();

  return (
    <View style={[styles.mark, { backgroundColor: colors.foreground, height: size, width: size }]}>
      <Svg height={size} viewBox="0 0 832 832" width={size}>
        <Rect fill={colors.background} height={132} rx={44} width={500} x={166} y={182} />
        <Rect fill={colors.background} height={364} rx={44} width={132} x={350} y={286} />
        <Rect fill={colors.background} height={132} rx={42} width={132} x={514} y={350} />
        <Path
          d="M580 382v68M546 416h68"
          stroke={colors.foreground}
          strokeLinecap="round"
          strokeWidth={22}
        />
        <Circle cx={615} cy={217} fill={colors.foreground} r={25} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    borderCurve: "continuous",
    borderRadius: radius.md,
    overflow: "hidden",
  },
  root: { alignItems: "center", flexDirection: "row", gap: 10 },
});
