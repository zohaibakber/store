import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";

import { useThemeColor } from "@/hooks/use-theme-color";

type ButtonProps = {
  children: ReactNode;
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
  const borderColor = variant === "outline" || variant === "secondary" ? separator : backgroundColor;
  const color = variant === "primary" ? onAccent : variant === "danger-soft" ? danger : foreground;
  const label = typeof children === "string" || typeof children === "number" ? String(children) : null;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        size === "sm" ? styles.small : styles.base,
        {
          backgroundColor,
          borderColor,
          opacity: isDisabled ? 0.48 : pressed ? 0.72 : 1,
        },
        style,
      ]}
      testID={testID}
    >
      {label ? (
        <Text style={[styles.label, { color }]}>{label}</Text>
      ) : (
        children
      )}
    </Pressable>
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
