import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { PressableScale } from "@/components/ui/pressable-scale";
import { useThemeColor } from "@/hooks/use-theme-color";

/** Row of low-emphasis text actions. Keeps steps down to one filled button. */
export function QuietActions({ children }: { readonly children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

export function QuietAction({
  isDisabled,
  label,
  onPress,
}: {
  readonly isDisabled?: boolean;
  readonly label: string;
  readonly onPress: () => void;
}) {
  const accent = useThemeColor("accent");

  return (
    <PressableScale isDisabled={isDisabled} onPress={onPress} style={styles.action}>
      <Text style={[styles.label, { color: accent }]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  action: { alignItems: "center", justifyContent: "center", minHeight: 44, paddingHorizontal: 8 },
  label: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20 },
  row: { alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "center" },
});
