import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { MobileClerkProvider } from "@/lib/clerk-provider";
import { followDeviceColorScheme, useAppColorScheme } from "@/theme/appearance";

followDeviceColorScheme();

export default function RootLayout() {
  const scheme = useAppColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <MobileClerkProvider>
        <ThemeProvider value={scheme === "dark" ? DarkTheme : DefaultTheme}>
          <StatusBar style={scheme === "dark" ? "light" : "dark"} />
          <Stack>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="auth" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="(app)" options={{ headerShown: false, gestureEnabled: false }} />
          </Stack>
        </ThemeProvider>
      </MobileClerkProvider>
    </GestureHandlerRootView>
  );
}
