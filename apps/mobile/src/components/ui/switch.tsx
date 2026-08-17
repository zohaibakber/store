import { Host, Switch as ExpoSwitch } from "@expo/ui";

import { useAppColorScheme } from "@/theme/appearance";
import { colors } from "@/theme/colors";

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
  const colorScheme = useAppColorScheme();
  return (
    <Host colorScheme={colorScheme} matchContents seedColor={colors.systemBlue}>
      <ExpoSwitch onValueChange={onSelectedChange} testID={testID} value={isSelected} />
    </Host>
  );
}
