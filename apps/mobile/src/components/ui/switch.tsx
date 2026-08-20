import { Switch as RNSwitch } from "react-native";

import { useColors } from "@/theme/colors";

/**
 * The platform switch — native gesture, size and animation — with the coss
 * colours: `primary` track when on, `input` when off, `background` thumb.
 */
export function Switch({
  accessibilityLabel,
  isDisabled,
  isSelected,
  onSelectedChange,
  testID,
}: {
  readonly accessibilityLabel?: string;
  readonly isDisabled?: boolean;
  readonly isSelected: boolean;
  readonly onSelectedChange: (selected: boolean) => void;
  readonly testID?: string;
}) {
  const colors = useColors();
  return (
    <RNSwitch
      accessibilityLabel={accessibilityLabel}
      disabled={isDisabled}
      ios_backgroundColor={colors.input}
      onValueChange={onSelectedChange}
      testID={testID}
      thumbColor={colors.background}
      trackColor={{ false: colors.input, true: colors.primary }}
      value={isSelected}
    />
  );
}
