import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { MobileAuthProvider } from "@/lib/auth-provider";
import { followDeviceColorScheme, useAppColorScheme } from "@/theme/appearance";

followDeviceColorScheme();

export default function RootLayout() {
  const scheme = useAppColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <MobileAuthProvider>
        <ThemeProvider value={scheme === "dark" ? DarkTheme : DefaultTheme}>
          <StatusBar style={scheme === "dark" ? "light" : "dark"} />
          <Stack>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            {/* Signing in and out is a state change, not navigation: cross-fade, never push. */}
            <Stack.Screen
              name="auth"
              options={{ animation: "fade", gestureEnabled: false, headerShown: false }}
            />
            <Stack.Screen
              name="(app)"
              options={{ animation: "fade", gestureEnabled: false, headerShown: false }}
            />
          </Stack>
        </ThemeProvider>
      </MobileAuthProvider>
    </GestureHandlerRootView>
  );
}
