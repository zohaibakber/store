import { Switch as RNSwitch } from "react-native";

import { useThemeColor } from "@/hooks/use-theme-color";

export function Switch({
  isSelected,
  onSelectedChange,
  testID,
}: {
  isSelected: boolean;
  onSelectedChange: (selected: boolean) => void;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const [accent, muted] = useThemeColor(["accent", "muted"]);
  return (
    <RNSwitch
      onValueChange={onSelectedChange}
      testID={testID}
      thumbColor={isSelected ? accent : undefined}
      trackColor={{ false: muted, true: accent }}
      value={isSelected}
    />
  );
}
