import { Image } from "expo-image";
import type { ColorValue, StyleProp, ImageStyle } from "react-native";

import { useAppColorScheme } from "@/theme/appearance";
import { colors, cssColor } from "@/theme/colors";

type SymbolProps = {
  name: string;
  size?: number;
  tintColor?: ColorValue;
  style?: StyleProp<ImageStyle>;
};

export function Symbol({ name, size = 20, tintColor, style }: SymbolProps) {
  useAppColorScheme();
  return (
    <Image
      contentFit="contain"
      source={`sf:${name}`}
      style={[{ height: size, width: size }, style]}
      tintColor={cssColor(tintColor ?? colors.label)}
    />
  );
}
