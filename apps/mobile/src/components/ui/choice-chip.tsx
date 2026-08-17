import type { ComponentProps, ReactNode } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { useThemeColor } from "@/hooks/use-theme-color";

type ChoiceChipProps = Omit<ComponentProps<typeof Pressable>, "children"> & {
  children: ReactNode;
  selected: boolean;
};

export function ChoiceChip({ children, selected, ...props }: ChoiceChipProps) {
  const [accent, accentForeground, surface, foreground] = useThemeColor([
    "accent",
    "accent-foreground",
    "surface-tertiary",
    "foreground",
  ]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? accent : surface,
          opacity: pressed ? 0.72 : 1,
        },
      ]}
      {...props}
    >
      <Text style={[styles.chipText, { color: selected ? accentForeground : foreground }]}>
        {children}
      </Text>
    </Pressable>
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
