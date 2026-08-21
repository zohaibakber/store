import { StyleSheet, Text } from "react-native";

import { PressableScale } from "@/components/ui/pressable-scale";
import { useColors } from "@/theme/colors";
import { radius } from "@/theme/tokens";
import { typography } from "@/theme/typography";

export function Chip({
  children,
  isSelected,
  onPress,
}: {
  readonly children: string;
  readonly isSelected: boolean;
  readonly onPress: () => void;
}) {
  const colors = useColors();

  return (
    <PressableScale
      accessibilityLabel={children}
      accessibilityState={{ selected: isSelected }}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: isSelected ? colors.primary : colors.secondary }]}
    >
      <Text
        style={[
          styles.label,
          { color: isSelected ? colors.primaryForeground : colors.secondaryForeground },
        ]}
      >
        {children}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: radius.full,
    height: 32,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  label: typography.label,
});
