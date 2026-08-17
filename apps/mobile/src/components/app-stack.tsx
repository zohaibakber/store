import { Stack } from "expo-router";
import type { ReactNode } from "react";

import { useThemeColor } from "@/hooks/use-theme-color";

const hideChrome = process.env.EXPO_OS === "android";

export function AppStack({ title, children }: { title: string; children?: ReactNode }) {
  const background = useThemeColor("background");
  const foreground = useThemeColor("foreground");
  const surface = useThemeColor("surface");
  const accent = useThemeColor("accent");

  return (
    <Stack
      screenOptions={{
        animation: hideChrome ? "none" : "default",
        contentStyle: { backgroundColor: background },
        headerBackTitle: "Back",
        headerShown: !hideChrome,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: surface },
        headerTintColor: accent,
        headerTitleStyle: { color: foreground, fontFamily: "Inter_500Medium" },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title,
          headerLargeTitle: !hideChrome,
          headerLargeTitleShadowVisible: false,
          headerLargeTitleStyle: { color: foreground, fontFamily: "Inter_500Medium" },
          headerShown: !hideChrome,
        }}
      />
      {children}
    </Stack>
  );
}
