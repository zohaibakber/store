import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { Icon, type IconName } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useColors } from "@/theme/colors";
import { radius } from "@/theme/tokens";

export function Empty({ children }: { readonly children: ReactNode }) {
  return <View style={styles.empty}>{children}</View>;
}

export function EmptyMedia({ name }: { readonly name: IconName }) {
  const colors = useColors();
  return (
    <View style={[styles.media, { backgroundColor: colors.secondary }]}>
      <Icon name={name} size={20} tone="muted" />
    </View>
  );
}

export function EmptyTitle({ children }: { readonly children: string }) {
  return <Text variant="bodyMedium">{children}</Text>;
}

export function EmptyDescription({ children }: { readonly children: string }) {
  return (
    <Text style={styles.centered} tone="muted" variant="caption">
      {children}
    </Text>
  );
}

export function EmptyContent({ children }: { readonly children: ReactNode }) {
  return <View style={styles.content}>{children}</View>;
}

const styles = StyleSheet.create({
  centered: { textAlign: "center" },
  content: { paddingTop: 8 },
  empty: { alignItems: "center", gap: 8, paddingHorizontal: 32, paddingVertical: 48 },
  media: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: radius.lg,
    height: 40,
    justifyContent: "center",
    marginBottom: 4,
    width: 40,
  },
});
