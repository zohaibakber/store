import type { ComponentProps } from "react";
import { StyleSheet, View } from "react-native";

export const TextField = ({
  isRequired: _isRequired,
  style,
  ...props
}: ComponentProps<typeof View> & { isRequired?: boolean }) => (
  <View style={[styles.field, style]} {...props} />
);

const styles = StyleSheet.create({
  field: { gap: 8 },
});
