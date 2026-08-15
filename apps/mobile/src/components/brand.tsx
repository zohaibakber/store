import { Text, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { useUniwind } from "uniwind";

export function Brand() {
  const { theme } = useUniwind();
  const isDark = theme === "dark";
  const mark = isDark ? "#2DD4BF" : "#0F766E";
  const glyph = isDark ? "#052E2B" : "#FFFFFF";

  return (
    <View className="flex-row items-center gap-2">
      <Svg accessibilityLabel="Tabaaq" height={28} viewBox="0 0 832 832" width={28}>
        <Rect fill={mark} height={832} rx={192} width={832} />
        <Rect fill={glyph} height={132} rx={44} width={500} x={166} y={182} />
        <Rect fill={glyph} height={364} rx={44} width={132} x={350} y={286} />
        <Rect fill={glyph} height={132} rx={42} width={132} x={514} y={350} />
        <Path d="M580 382v68M546 416h68" stroke={mark} strokeLinecap="round" strokeWidth={22} />
        <Circle cx={615} cy={217} fill={mark} r={25} />
      </Svg>
      <View>
        <Text className="text-lg leading-5 font-medium text-foreground">Tabaaq</Text>
        <Text className="text-xs text-muted">Inventory, in sync</Text>
      </View>
    </View>
  );
}
