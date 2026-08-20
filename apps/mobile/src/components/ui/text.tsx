import type { ComponentProps } from "react";
import { StyleSheet, Text as RNText } from "react-native";

import { useColors } from "@/theme/colors";
import { typography, type TypeVariant } from "@/theme/typography";

type Tone = "default" | "muted" | "destructive" | "success" | "warning" | "info" | "inverse";

export type TextProps = ComponentProps<typeof RNText> & {
  readonly variant?: TypeVariant;
  readonly tone?: Tone;
};

/**
 * The only place font family, size and weight are chosen. Everything else in
 * the app picks a variant from `design-system.md` §3 rather than restating
 * `fontFamily: "Inter_500Medium", fontSize: 14`.
 */
export function Text({ variant = "body", tone = "default", style, ...props }: TextProps) {
  const colors = useColors();
  const color = {
    default: colors.foreground,
    destructive: colors.destructiveForeground,
    info: colors.infoForeground,
    inverse: colors.primaryForeground,
    muted: colors.mutedForeground,
    success: colors.successForeground,
    warning: colors.warningForeground,
  }[tone];

  return <RNText style={[typography[variant], { color }, style]} {...props} />;
}

/** Section heading above a list or card group. */
export function SectionTitle({ style, ...props }: ComponentProps<typeof Text>) {
  return <Text style={[styles.section, style]} tone="muted" variant="label" {...props} />;
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16 },
});
