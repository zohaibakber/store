import "../global.css";
import { useAuth } from "@clerk/expo";
import { AuthView } from "@clerk/expo/native";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Modal, useColorScheme, View } from "react-native";
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
            background: "#07121F",
            border: "#23384C",
            card: "#0E1D2C",
            primary: "#2DD4BF",
            text: "#EDF6FF",
          },
        }
      : {
          ...DefaultTheme,
          colors: {
            ...DefaultTheme.colors,
            background: "#F2F6FA",
            border: "#CFDAE6",
            card: "#FFFFFF",
            primary: "#0F766E",
            text: "#10233D",
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
        <View collapsable={false} className="flex-1 overflow-hidden bg-background">
          <AuthView isDismissible={false} mode="signInOrUp" onDismiss={() => setAuthOpen(false)} />
        </View>
      </Modal>
    </ThemeProvider>
  );
}
