import "@azure/core-asynciterator-polyfill";
import {
  DarkTheme,
  DefaultTheme,
  ErrorBoundary as ExpoErrorBoundary,
  Stack,
  ThemeProvider,
} from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { MobileAuthProvider } from "@/lib/auth-provider";
import { initMobileSentry, Sentry } from "@/lib/sentry";
import { followDeviceColorScheme, useAppColorScheme } from "@/theme/appearance";
import { palettes } from "@/theme/tokens";

initMobileSentry();

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

function RootLayout() {
  const scheme = useAppColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <MobileAuthProvider>
        <ThemeProvider value={navigationTheme(scheme)}>
          <StatusBar style={scheme === "dark" ? "light" : "dark"} />
          <Stack>
            <Stack.Screen name="index" options={{ headerShown: false }} />
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

export default Sentry.wrap(RootLayout);

export const ErrorBoundary = Sentry.wrapExpoRouterErrorBoundary(ExpoErrorBoundary);
