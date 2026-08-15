import "../global.css";
import { useAuth } from "@clerk/expo";
import { AuthView } from "@clerk/expo/native";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Modal, StyleSheet, useColorScheme, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { MobileClerkProvider } from "@/lib/clerk-provider";

export default function RootLayout() {
  const scheme = useColorScheme();
  const theme =
    scheme === "dark"
      ? {
          ...DarkTheme,
          colors: {
            ...DarkTheme.colors,
            background: "#111111",
            border: "#2B2B2B",
            card: "#141414",
            primary: "#F5F5F5",
            text: "#F5F5F5",
          },
        }
      : {
          ...DefaultTheme,
          colors: {
            ...DefaultTheme.colors,
            background: "#FFFFFF",
            border: "#E5E5E5",
            card: "#FFFFFF",
            primary: "#262626",
            text: "#262626",
          },
        };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <MobileClerkProvider>
        <MobileAppShell theme={theme} />
      </MobileClerkProvider>
    </GestureHandlerRootView>
  );
}

function MobileAppShell({ theme }: { theme: typeof DefaultTheme }) {
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    if (isLoaded && !isSignedIn) setAuthOpen(true);
  }, [isLoaded, isSignedIn]);

  return (
    <ThemeProvider value={theme}>
      <StatusBar style="auto" />
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
