import { Button as ExpoButton, Host } from "@expo/ui";
import * as Schema from "effect/Schema";
import type { ReactNode } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";

import { useAppColorScheme } from "@/theme/appearance";
import { colors } from "@/theme/colors";

type ButtonProps = {
  children: ReactNode;
  isDisabled?: boolean;
  onPress?: () => void;
  size?: "sm" | "md";
  style?: StyleProp<ViewStyle>;
  testID?: string;
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger-soft";
};

const nativeButtonVariant = {
  primary: "filled",
  secondary: "outlined",
  outline: "outlined",
  ghost: "text",
  "danger-soft": "outlined",
} as const;

export function Button({
  children,
  isDisabled,
  onPress,
  size = "md",
  style,
  testID,
  variant = "primary",
}: ButtonProps) {
  const colorScheme = useAppColorScheme();
  const label =
    Schema.is(Schema.String)(children) || Schema.is(Schema.Number)(children)
      ? String(children)
      : undefined;

  return (
    <Host
      colorScheme={colorScheme}
      matchContents={{ vertical: true }}
      seedColor={variant === "danger-soft" ? colors.systemRed : colors.systemBlue}
      style={style}
    >
      <ExpoButton
        disabled={isDisabled}
        label={label}
        onPress={onPress}
        style={size === "sm" ? styles.nativeButtonSmall : styles.nativeButton}
        testID={testID}
        variant={nativeButtonVariant[variant]}
      >
        {label ? undefined : children}
      </ExpoButton>
    </Host>
  );
}

const styles = StyleSheet.create({
  nativeButton: {
    borderRadius: 10,
    height: 48,
  },
  nativeButtonSmall: {
    borderRadius: 10,
    height: 40,
  },
});
