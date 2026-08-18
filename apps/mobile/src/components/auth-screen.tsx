import { useAuth } from "@clerk/expo";
import { AuthView } from "@clerk/expo/native";
import { Redirect } from "expo-router";
import { StyleSheet, View } from "react-native";

import { LoadingScreen } from "@/components/loading-screen";
import { useThemeColor } from "@/hooks/use-theme-color";
import { useLastUserId } from "@/lib/local-session";

export function AuthScreen() {
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const lastUserId = useLastUserId();
  const background = useThemeColor("background");

  if (isSignedIn) return <Redirect href="/home" />;
  if (!isLoaded && lastUserId) return <Redirect href="/home" />;
  if (!isLoaded) return <LoadingScreen />;

  return (
    <View collapsable={false} style={[styles.root, { backgroundColor: background }]}>
      <AuthView isDismissible={false} mode="signInOrUp" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden" },
});
