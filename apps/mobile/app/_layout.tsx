import { useAuth } from "@clerk/expo";
import { AuthView } from "@clerk/expo/native";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Modal, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { MobileClerkProvider } from "@/lib/clerk-provider";
import { followDeviceColorScheme, useAppColorScheme } from "@/theme/appearance";

followDeviceColorScheme();

export default function RootLayout() {
  const scheme = useAppColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <MobileClerkProvider>
        <MobileAppShell theme={scheme === "dark" ? DarkTheme : DefaultTheme} />
      </MobileClerkProvider>
    </GestureHandlerRootView>
  );
}

function MobileAppShell({ theme }: { theme: typeof DefaultTheme }) {
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;
    setAuthOpen(!isSignedIn);
  }, [isLoaded, isSignedIn]);

  return (
    <ThemeProvider value={theme}>
      <StatusBar style={theme.dark ? "light" : "dark"} />
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="auth" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="(app)" options={{ headerShown: false, gestureEnabled: false }} />
      </Stack>
      <Modal
        animationType="fade"
        onRequestClose={() => undefined}
        presentationStyle="fullScreen"
        visible={authOpen}
      >
        <View collapsable={false} style={styles.authContainer}>
          <AuthView isDismissible={false} mode="signInOrUp" onDismiss={() => setAuthOpen(false)} />
        </View>
      </Modal>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  authContainer: { flex: 1, overflow: "hidden" },
});
