import type { ComponentProps } from "react";
import { StyleSheet, View } from "react-native";

import { Text } from "@/components/ui/text";
import { useColors } from "@/theme/colors";
import { radius } from "@/theme/tokens";

/** A grouped content surface: `card` fill, hairline border, no shadow. */
export function Card({ style, ...props }: ComponentProps<typeof View>) {
  const colors = useColors();
  return (
    <View
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, style]}
      {...props}
    />
  );
}

export function CardHeader({ style, ...props }: ComponentProps<typeof View>) {
  return <View style={[styles.header, style]} {...props} />;
}

export function CardContent({ style, ...props }: ComponentProps<typeof View>) {
  return <View style={[styles.content, style]} {...props} />;
}

export function CardFooter({ style, ...props }: ComponentProps<typeof View>) {
  return <View style={[styles.footer, style]} {...props} />;
}

export function CardTitle({ children }: { readonly children: string }) {
  return <Text variant="subheading">{children}</Text>;
}

export function CardDescription({ children }: { readonly children: string }) {
  return (
    <Text tone="muted" variant="caption">
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  card: {
    borderCurve: "continuous",
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  content: { gap: 12, padding: 16 },
  footer: { gap: 12, paddingBottom: 16, paddingHorizontal: 16 },
  header: { gap: 4, padding: 16 },
});
