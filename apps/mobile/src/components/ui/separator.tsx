import { StyleSheet, View } from "react-native";

import { useThemeColor } from "@/hooks/use-theme-color";

export const Separator = ({
  orientation = "horizontal",
}: {
  orientation?: "horizontal" | "vertical";
}) => {
  const separator = useThemeColor("separator");
  return (
    <View
      style={[
        orientation === "vertical" ? styles.separatorVertical : styles.separator,
        { backgroundColor: separator },
      ]}
    />
  );
};

const styles = StyleSheet.create({
  separator: { height: StyleSheet.hairlineWidth },
  separatorVertical: { marginHorizontal: 8, width: StyleSheet.hairlineWidth },
});
