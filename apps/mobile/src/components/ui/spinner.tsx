import { ActivityIndicator, type ColorValue } from "react-native";

import { useThemeColor } from "@/hooks/use-theme-color";

export const Spinner = ({
  color,
  size = "small",
}: {
  color?: ColorValue;
  size?: "sm" | "small" | "large";
}) => {
  const defaultColor = useThemeColor("foreground");
  return (
    <ActivityIndicator
      color={!color || color === "default" ? defaultColor : color}
      size={size === "sm" ? "small" : size}
    />
  );
};
