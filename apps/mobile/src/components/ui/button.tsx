import { StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";

import { PressableScale } from "@/components/ui/pressable-scale";
import { useThemeColor } from "@/hooks/use-theme-color";

type ButtonProps = {
  children: string;
  isDisabled?: boolean;
  onPress?: () => void;
  size?: "sm" | "md";
  style?: StyleProp<ViewStyle>;
  testID?: string;
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger-soft";
};

export function Button({
  children,
  isDisabled,
  onPress,
  size = "md",
  style,
  testID,
  variant = "primary",
}: ButtonProps) {
  const [accent, onAccent, foreground, surface, separator, danger, dangerSoft] = useThemeColor([
    "accent",
    "accent-foreground",
    "foreground",
    "surface",
    "separator",
    "danger",
    "danger-soft",
  ]);
  const backgroundColor =
    variant === "primary"
      ? accent
      : variant === "danger-soft"
        ? dangerSoft
        : variant === "ghost"
          ? "transparent"
          : surface;
  const borderColor =
    variant === "outline" || variant === "secondary" ? separator : backgroundColor;
  const color = variant === "primary" ? onAccent : variant === "danger-soft" ? danger : foreground;

  return (
    <PressableScale
      isDisabled={isDisabled}
      layoutStyle={style}
      onPress={onPress}
      style={[size === "sm" ? styles.small : styles.base, { backgroundColor, borderColor }]}
      testID={testID}
    >
      <Text style={[styles.label, { color }]}>{children}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    height: 48,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  label: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20 },
  small: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    height: 40,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
});
