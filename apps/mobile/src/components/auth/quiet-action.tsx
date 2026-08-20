import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { Button, ButtonText } from "@/components/ui/button";

/** Row of low-emphasis actions. Keeps every step down to one filled button. */
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
  return (
    <Button accessibilityLabel={label} isDisabled={isDisabled} onPress={onPress} variant="link">
      <ButtonText>{label}</ButtonText>
    </Button>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "center" },
});
