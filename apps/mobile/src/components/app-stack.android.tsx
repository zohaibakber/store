import { useMaterialColors } from "@expo/ui/jetpack-compose";
import { Stack } from "expo-router";
import type { ReactNode } from "react";

import { useAppColorScheme } from "@/theme/appearance";

export function AppStack({ title, children }: { title: string; children?: ReactNode }) {
  const colorScheme = useAppColorScheme();
  const colors = useMaterialColors({ colorScheme });

  return (
    <Stack
      key={colorScheme}
      screenOptions={{
        animation: "none",
        contentStyle: { backgroundColor: colors.surfaceContainer },
        headerBackTitle: "Back",
        headerShown: false,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.onSurface, fontFamily: "Inter_500Medium" },
      }}
    >
      <Stack.Screen name="index" options={{ headerLargeTitle: false, headerShown: false, title }} />
      {children}
    </Stack>
  );
}
