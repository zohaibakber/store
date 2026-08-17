import { Image } from "expo-image";
import type { ColorValue, StyleProp, ImageStyle, ViewStyle } from "react-native";
import { View } from "react-native";

import { colors, cssColor } from "@/theme/colors";

type SymbolProps = {
  name: string;
  size?: number;
  tintColor?: ColorValue;
  style?: StyleProp<ImageStyle | ViewStyle>;
};

export function IconSymbol({ name, size = 20, tintColor, style }: SymbolProps) {
  const color = cssColor(tintColor ?? colors.label);
  if (process.env.EXPO_OS === "ios") {
    return (
      <Image
        contentFit="contain"
        source={`sf:${name}`}
        // SAFETY: This branch only mounts Image, which consumes the ImageStyle fields of the shared style bag.
        style={[{ height: size, width: size }, style as StyleProp<ImageStyle>]}
        tintColor={color}
      />
    );
  }

  return (
    <View
      accessibilityLabel={name}
      style={[
        {
          backgroundColor: color,
          borderCurve: "continuous",
          borderRadius: Math.max(2, size / 5),
          height: size,
          opacity: 0.72,
          width: size,
        },
        // SAFETY: This branch only mounts View, which consumes the ViewStyle fields of the shared style bag.
        style as StyleProp<ViewStyle>,
      ]}
    />
  );
}
