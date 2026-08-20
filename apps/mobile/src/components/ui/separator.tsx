import { StyleSheet, View } from "react-native";

import { useColors } from "@/theme/colors";

/** A hairline in `border`. `inset` clears a leading slot, e.g. a row avatar. */
export function Separator({
  inset = 0,
  orientation = "horizontal",
}: {
  readonly inset?: number;
  readonly orientation?: "horizontal" | "vertical";
}) {
  const colors = useColors();
  return (
    <View
      style={[
        orientation === "vertical" ? styles.vertical : styles.horizontal,
        orientation === "horizontal" && { marginStart: inset },
        { backgroundColor: colors.border },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  horizontal: { height: StyleSheet.hairlineWidth },
  vertical: { alignSelf: "stretch", width: StyleSheet.hairlineWidth },
});
