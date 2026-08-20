import { StyleSheet, Text, View } from "react-native";

import { GoogleMark } from "@/components/auth/google-mark";
import { PressableScale } from "@/components/ui/pressable-scale";
import { useThemeColor } from "@/hooks/use-theme-color";

/** Opens Google's account picker. Quieter than the email action on purpose. */
export function GoogleAction({
  isDisabled,
  onPress,
}: {
  readonly isDisabled?: boolean;
  readonly onPress: () => void;
}) {
  const [foreground, surface] = useThemeColor(["foreground", "surface"]);

  return (
    <PressableScale
      accessibilityLabel="Continue with Google"
      isDisabled={isDisabled}
      onPress={onPress}
      style={[styles.row, { backgroundColor: surface }]}
    >
      <View style={styles.mark}>
        <GoogleMark />
      </View>
      <Text style={[styles.label, { color: foreground }]}>Continue with Google</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20 },
  mark: { alignItems: "center", height: 18, justifyContent: "center", width: 18 },
  row: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 10,
    flexDirection: "row",
    gap: 10,
    height: 48,
    justifyContent: "center",
  },
});
