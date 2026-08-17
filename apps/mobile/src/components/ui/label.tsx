import type { ComponentProps } from "react";
import { StyleSheet, Text } from "react-native";

import { useThemeColor } from "@/hooks/use-theme-color";

export const Label = ({ style, ...props }: ComponentProps<typeof Text>) => {
  const foreground = useThemeColor("foreground");
  return <Text style={[styles.label, { color: foreground }, style]} {...props} />;
};

const styles = StyleSheet.create({
  label: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 2,
  },
});
