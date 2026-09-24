import { Host } from "@expo/ui";
import { Button, OutlinedButton, Text, TextButton } from "@expo/ui/jetpack-compose";

import { colors, fonts, type } from "@/theme/tokens";

const filledColors = {
  containerColor: colors.ink,
  contentColor: colors.ground,
  disabledContainerColor: colors.surface,
  disabledContentColor: colors.placeholder,
};
const quietColors = {
  containerColor: "transparent",
  contentColor: colors.ink,
  disabledContainerColor: "transparent",
  disabledContentColor: colors.placeholder,
};
const labelStyle = {
  fontFamily: fonts.medium,
  fontSize: type.sm.fontSize,
  lineHeight: type.sm.lineHeight,
};

export type ActionButtonVariant = "filled" | "outlined" | "text";

export type ActionButtonProps = {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: ActionButtonVariant;
  readonly disabled?: boolean;
};

export function ComposeActionButton({
  label,
  onPress,
  variant = "filled",
  disabled = false,
}: ActionButtonProps) {
  const content = <Text style={labelStyle}>{label}</Text>;
  switch (variant) {
    case "filled":
      return (
        <Button colors={filledColors} enabled={!disabled} onClick={onPress}>
          {content}
        </Button>
      );
    case "outlined":
      return (
        <OutlinedButton colors={quietColors} enabled={!disabled} onClick={onPress}>
          {content}
        </OutlinedButton>
      );
    case "text":
      return (
        <TextButton colors={quietColors} enabled={!disabled} onClick={onPress}>
          {content}
        </TextButton>
      );
  }
}

export function ActionButton(props: ActionButtonProps) {
  return (
    <Host matchContents>
      <ComposeActionButton {...props} />
    </Host>
  );
}
