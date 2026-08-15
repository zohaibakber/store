import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { useThemeColor } from "@/components/mobile-ui";

export function Brand() {
  const [foreground, muted, inverse] = useThemeColor(["foreground", "muted", "accent-foreground"]);

  return (
    <View style={styles.root}>
      <Svg accessibilityLabel="Tabaaq" height={28} viewBox="0 0 832 832" width={28}>
        <Rect fill={foreground} height={832} rx={192} width={832} />
        <Rect fill={inverse} height={132} rx={44} width={500} x={166} y={182} />
        <Rect fill={inverse} height={364} rx={44} width={132} x={350} y={286} />
        <Rect fill={inverse} height={132} rx={42} width={132} x={514} y={350} />
        <Path
          d="M580 382v68M546 416h68"
          stroke={foreground}
          strokeLinecap="round"
          strokeWidth={22}
        />
        <Circle cx={615} cy={217} fill={foreground} r={25} />
      </Svg>
      <View>
        <Text style={[styles.title, { color: foreground }]}>Tabaaq</Text>
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
