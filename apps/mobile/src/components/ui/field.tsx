import type { ComponentProps } from "react";
import { StyleSheet, View } from "react-native";

import { Text } from "@/components/ui/text";

export function Field({ style, ...props }: ComponentProps<typeof View>) {
  return <View style={[styles.field, style]} {...props} />;
}

export function FieldLabel({ children }: { readonly children: string }) {
  return <Text variant="label">{children}</Text>;
}

export function FieldDescription({ children }: { readonly children: string }) {
  return (
    <Text tone="muted" variant="caption">
      {children}
    </Text>
  );
}

export function FieldError({ children }: { readonly children: string }) {
  return (
    <Text selectable tone="destructive" variant="caption">
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
});
