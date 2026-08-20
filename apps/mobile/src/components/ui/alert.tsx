import { createContext, use, type ComponentProps, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { Icon, type IconName } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { statusSurface, useColors, type StatusToken } from "@/theme/colors";
import { radius } from "@/theme/tokens";

export type AlertVariant = "default" | StatusToken;

const iconFor = {
  default: "info",
  destructive: "alert",
  info: "info",
  success: "check",
  warning: "alert",
} as const satisfies Record<AlertVariant, IconName>;

const AlertContext = createContext<AlertVariant>("default");

/**
 * Inline, persistent status. The coss Alert recipe: a 6% wash of the status
 * colour inside a 32% border, icon in the status colour, title in `foreground`,
 * body in `mutedForeground`. `default` is untinted.
 */
export function Alert({
  children,
  variant = "default",
  style,
  ...props
}: ComponentProps<typeof View> & { readonly variant?: AlertVariant }) {
  const colors = useColors();
  const surface =
    variant === "default"
      ? { backgroundColor: colors.card, borderColor: colors.border }
      : statusSurface(colors, variant);

  return (
    <AlertContext value={variant}>
      <View accessibilityRole="alert" style={[styles.alert, surface, style]} {...props}>
        <AlertIndicator />
        <View style={styles.body}>{children}</View>
      </View>
    </AlertContext>
  );
}

function AlertIndicator() {
  const variant = use(AlertContext);
  const tone =
    variant === "default" ? "muted" : variant === "destructive" ? "destructive" : variant;
  return <Icon name={iconFor[variant]} style={styles.icon} tone={tone} />;
}

export function AlertTitle({ children }: { readonly children: string }) {
  return <Text variant="bodyMedium">{children}</Text>;
}

export function AlertDescription({ children }: { readonly children: string }) {
  return (
    <Text selectable tone="muted" variant="caption">
      {children}
    </Text>
  );
}

/** Trailing action, at most one, always `ghost` or `outline`. */
export function AlertAction({ children }: { readonly children: ReactNode }) {
  return <View style={styles.action}>{children}</View>;
}

const styles = StyleSheet.create({
  action: { alignItems: "flex-start", paddingTop: 4 },
  alert: {
    borderCurve: "continuous",
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  body: { flex: 1, gap: 2, minWidth: 0 },
  icon: { marginTop: 1 },
});
