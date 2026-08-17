import { StyleSheet, View } from "react-native";

import { Spinner } from "@/components/ui/spinner";
import { useThemeColor } from "@/hooks/use-theme-color";

export function LoadingScreen() {
  const background = useThemeColor("background");
  return (
    <View style={[styles.root, { backgroundColor: background }]}>
      <Spinner color="default" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", flex: 1, justifyContent: "center" },
});
