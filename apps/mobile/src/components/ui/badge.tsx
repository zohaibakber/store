import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useThemeColor } from "@/hooks/use-theme-color";

export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "danger" | "warning" | "success";
}) {
  const [surface, foreground, danger, dangerSoft, warning, warningSoft, success, successSoft] =
    useThemeColor([
      "surface-tertiary",
      "foreground",
      "danger",
      "danger-soft",
      "warning",
      "warning-soft",
      "success",
      "success-soft",
    ]);
  const toneColors = {
    default: [surface, foreground],
    danger: [dangerSoft, danger],
    success: [successSoft, success],
    warning: [warningSoft, warning],
  } as const;
  const [backgroundColor, color] = toneColors[tone];
  return (
    <View style={[styles.chip, { backgroundColor }]}>
      <Text style={[styles.chipText, { color }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: 12,
  },
  chipText: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 16 },
});
