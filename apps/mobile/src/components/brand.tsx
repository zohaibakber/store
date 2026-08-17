import { StyleSheet, Text, View, type ColorValue } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { useThemeColor } from "@/hooks/use-theme-color";
import { cssColor } from "@/theme/colors";

export function Brand({
  foreground: foregroundOverride,
  muted: mutedOverride,
  inverse: inverseOverride,
}: {
  foreground?: ColorValue;
  muted?: ColorValue;
  inverse?: ColorValue;
} = {}) {
  const [themeForeground, themeMuted, themeInverse] = useThemeColor([
    "foreground",
    "muted",
    "accent-foreground",
  ]);
  const foreground = foregroundOverride ?? themeForeground;
  const muted = mutedOverride ?? themeMuted;
  const inverse = inverseOverride ?? themeInverse;
  const mark = cssColor(foreground);
  const cutout = cssColor(inverse);

  return (
    <View style={styles.root}>
      <Svg
        accessibilityLabel={__DEV__ ? "Tabaaq Dev" : "Tabaaq"}
        height={28}
        viewBox="0 0 832 832"
        width={28}
      >
        <Rect fill={mark} height={832} rx={192} width={832} />
        <Rect fill={cutout} height={132} rx={44} width={500} x={166} y={182} />
        <Rect fill={cutout} height={364} rx={44} width={132} x={350} y={286} />
        <Rect fill={cutout} height={132} rx={42} width={132} x={514} y={350} />
        <Path d="M580 382v68M546 416h68" stroke={mark} strokeLinecap="round" strokeWidth={22} />
        <Circle cx={615} cy={217} fill={mark} r={25} />
      </Svg>
      <View>
        <Text style={[styles.title, { color: foreground }]}>
          {__DEV__ ? "Tabaaq Dev" : "Tabaaq"}
        </Text>
        <Text style={[styles.subtitle, { color: muted }]}>Inventory, in sync</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", flexDirection: "row", gap: 8 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 16 },
  title: { fontFamily: "Inter_500Medium", fontSize: 18, lineHeight: 20 },
});
