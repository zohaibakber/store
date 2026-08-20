import { StyleSheet, View } from "react-native";

import { Spinner } from "@/components/ui/spinner";
import { useColors } from "@/theme/colors";

/** The gap between launch and a resolved session. Nothing but the indicator. */
export function LoadingScreen() {
  const colors = useColors();
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Spinner tone="muted" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", flex: 1, justifyContent: "center" },
});
