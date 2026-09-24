import { Host } from "@expo/ui";
import { Button, CircularProgressIndicator, Row, Text, TextButton } from "@expo/ui/jetpack-compose";
import { defaultMinSize, fillMaxWidth, height, size } from "@expo/ui/jetpack-compose/modifiers";

import { colors, fonts, touch, type } from "@/theme/tokens";

export type ActionButtonVariant = "primary" | "secondary" | "quiet";

export type ActionButtonProps = {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: ActionButtonVariant;
  readonly loading?: boolean;
  readonly disabled?: boolean;
};

const palette = {
  primary: { container: colors.ink, content: colors.ground },
  secondary: { container: colors.surface, content: colors.ink },
  quiet: { container: colors.ground, content: colors.ink },
} satisfies Record<ActionButtonVariant, { readonly container: string; readonly content: string }>;

function Label({
  label,
  color,
  loading,
}: {
  readonly label: string;
  readonly color: string;
  readonly loading: boolean;
}) {
  return (
    <Row horizontalArrangement={{ spacedBy: 12 }} verticalAlignment="center">
      {loading ? (
        <CircularProgressIndicator color={color} strokeWidth={2} modifiers={[size(18, 18)]} />
      ) : null}
      <Text
        color={color}
        style={{
          fontFamily: fonts.medium,
          fontSize: type.base.fontSize,
          lineHeight: type.base.lineHeight,
        }}
      >
        {label}
      </Text>
    </Row>
  );
}

export function ActionButton({
  label,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
}: ActionButtonProps) {
  const enabled = !disabled && !loading;
  const { container, content } = palette[variant];
  const contentColor = disabled && !loading ? colors.muted : content;

  if (variant === "quiet") {
    return (
      <Host matchContents colorScheme="light">
        <TextButton
          onClick={onPress}
          enabled={enabled}
          colors={{ contentColor, disabledContentColor: contentColor }}
          modifiers={[defaultMinSize({ minHeight: touch.minimum })]}
        >
          <Label label={label} color={contentColor} loading={loading} />
        </TextButton>
      </Host>
    );
  }

  return (
    <Host matchContents={{ vertical: true }} colorScheme="light" style={{ alignSelf: "stretch" }}>
      <Button
        onClick={onPress}
        enabled={enabled}
        colors={{
          containerColor: container,
          contentColor,
          disabledContainerColor: loading ? container : colors.hairline,
          disabledContentColor: contentColor,
        }}
        modifiers={[fillMaxWidth(), height(touch.primary)]}
      >
        <Label label={label} color={contentColor} loading={loading} />
      </Button>
    </Host>
  );
}
