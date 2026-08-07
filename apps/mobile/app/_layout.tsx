import "../global.css";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { HeroUINativeProvider } from "heroui-native/provider";
import { useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

export default function RootLayout() {
  const scheme = useColorScheme();
  const theme = scheme === "dark" ? DarkTheme : DefaultTheme;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider>
        <ThemeProvider value={theme}>
          <StatusBar style="auto" />
          <Stack>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="auth" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="(app)" options={{ headerShown: false, gestureEnabled: false }} />
          </Stack>
        </ThemeProvider>
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
