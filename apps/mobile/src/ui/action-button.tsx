import { Host } from "@expo/ui";
import {
  Button,
  CircularProgressIndicator,
  FilledTonalButton,
  OutlinedButton,
  Row,
  Text,
  TextButton,
} from "@expo/ui/jetpack-compose";
import { defaultMinSize, fillMaxWidth, height, size } from "@expo/ui/jetpack-compose/modifiers";
import { StyleSheet } from "react-native";

import { colors, fonts, touch, type } from "@/theme/tokens";

type ActionButtonVariant = "primary" | "secondary" | "outlined" | "text";

type ActionButtonSize = "medium" | "large";

type ActionButtonProps = {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: ActionButtonVariant;
  readonly size?: ActionButtonSize;
  readonly loading?: boolean;
  readonly disabled?: boolean;
};

type Palette = {
  readonly container: string;
  readonly content: string;
  readonly disabledContainer: string;
};

const palettes = {
  primary: { container: colors.ink, content: colors.ground, disabledContainer: colors.hairline },
  secondary: { container: colors.surface, content: colors.ink, disabledContainer: colors.hairline },
  outlined: { container: "transparent", content: colors.ink, disabledContainer: "transparent" },
  text: { container: "transparent", content: colors.ink, disabledContainer: "transparent" },
} satisfies Record<ActionButtonVariant, Palette>;

const buttons = {
  primary: Button,
  secondary: FilledTonalButton,
  outlined: OutlinedButton,
  text: TextButton,
} as const;

const labelStyles = {
  medium: { fontFamily: fonts.medium, ...type.sm },
  large: { fontFamily: fonts.medium, ...type.base },
} as const;

const blockModifiers = [fillMaxWidth(), height(touch.primary)];
const inlineModifiers = [defaultMinSize({ minHeight: touch.minimum })];
const spinnerModifiers = [size(18, 18)];

const fillsWidth = (variant: ActionButtonVariant, buttonSize: ActionButtonSize) =>
  buttonSize === "large" && variant !== "text";

export function ComposeActionButton({
  label,
  onPress,
  variant = "primary",
  size: buttonSize = "medium",
  loading = false,
  disabled = false,
}: ActionButtonProps) {
  const palette = palettes[variant];
  const content = disabled && !loading ? colors.muted : palette.content;
  const Component = buttons[variant];
  return (
    <Component
      onClick={onPress}
      enabled={!disabled && !loading}
      colors={{
        containerColor: palette.container,
        contentColor: content,
        disabledContainerColor: loading ? palette.container : palette.disabledContainer,
        disabledContentColor: content,
      }}
      modifiers={fillsWidth(variant, buttonSize) ? blockModifiers : inlineModifiers}
    >
      <Row horizontalArrangement={{ spacedBy: 12 }} verticalAlignment="center">
        {loading ? (
          <CircularProgressIndicator color={content} strokeWidth={2} modifiers={spinnerModifiers} />
        ) : null}
        <Text color={content} style={labelStyles[buttonSize]}>
          {label}
        </Text>
      </Row>
    </Component>
  );
}

export function ActionButton(props: ActionButtonProps) {
  if (fillsWidth(props.variant ?? "primary", props.size ?? "medium")) {
    return (
      <Host matchContents={{ vertical: true }} colorScheme="light" style={styles.block}>
        <ComposeActionButton {...props} />
      </Host>
    );
  }
  return (
    <Host matchContents colorScheme="light">
      <ComposeActionButton {...props} />
    </Host>
  );
}

const styles = StyleSheet.create({
  block: { alignSelf: "stretch" },
});
