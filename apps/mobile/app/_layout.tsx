import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { MobileAuthProvider } from "@/lib/auth-provider";
import { followDeviceColorScheme, useAppColorScheme } from "@/theme/appearance";
import { palettes } from "@/theme/tokens";

followDeviceColorScheme();

/**
 * React Navigation's own themes ship iOS blue as `primary` and use it for the
 * back button, the header tint and the ripple. Rebuild them from the palette so
 * the navigator can't paint anything we didn't choose.
 */
const navigationTheme = (scheme: "light" | "dark") => {
  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  const colors = palettes[scheme];

  return {
    ...base,
    colors: {
      background: colors.background,
      border: colors.border,
      card: colors.background,
      notification: colors.destructive,
      primary: colors.foreground,
      text: colors.foreground,
    },
  };
};

export default function RootLayout() {
  const scheme = useAppColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <MobileAuthProvider>
        <ThemeProvider value={navigationTheme(scheme)}>
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
