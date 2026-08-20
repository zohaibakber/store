import { StyleSheet, Text } from "react-native";

import { useColors } from "@/theme/colors";
import { alpha, radius } from "@/theme/tokens";
import { typography } from "@/theme/typography";

export type BadgeVariant = "default" | "secondary" | "outline" | "error" | "warning" | "success";

/**
 * A short status label. It *is* a text node, so it takes a string child and
 * renders as styled `Text` rather than a View wrapper. Badges label; they do not
 * shout — no pill radius, no uppercase. See `design-system.md` §5.
 */
export function Badge({
  children,
  variant = "secondary",
}: {
  readonly children: string;
  readonly variant?: BadgeVariant;
}) {
  const colors = useColors();
  const { backgroundColor, borderColor, color } = {
    default: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
      color: colors.primaryForeground,
    },
    error: {
      backgroundColor: alpha(colors.destructive, 0.1),
      borderColor: "transparent",
      color: colors.destructiveForeground,
    },
    outline: {
      backgroundColor: colors.card,
      borderColor: colors.input,
      color: colors.foreground,
    },
    secondary: {
      backgroundColor: colors.secondary,
      borderColor: "transparent",
      color: colors.secondaryForeground,
    },
    success: {
      backgroundColor: alpha(colors.success, 0.12),
      borderColor: "transparent",
      color: colors.successForeground,
    },
    warning: {
      backgroundColor: alpha(colors.warning, 0.12),
      borderColor: "transparent",
      color: colors.warningForeground,
    },
  }[variant];

  return (
    <Text numberOfLines={1} style={[styles.badge, { backgroundColor, borderColor, color }]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  badge: {
    ...typography.label,
    borderCurve: "continuous",
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
});
