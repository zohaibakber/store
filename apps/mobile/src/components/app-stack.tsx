import { Stack } from "expo-router";
import { useThemeColor } from "heroui-native";
import type { ReactNode } from "react";

export function AppStack({ title, children }: { title: string; children?: ReactNode }) {
  const background = useThemeColor("background");
  const foreground = useThemeColor("foreground");

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: background },
        headerBackTitle: "Back",
        headerShadowVisible: false,
        headerStyle: { backgroundColor: background },
        headerTintColor: foreground,
        headerTitleStyle: { color: foreground, fontFamily: "Inter_500Medium" },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title,
          headerLargeTitle: true,
          headerLargeTitleShadowVisible: false,
          headerLargeTitleStyle: { color: foreground, fontFamily: "Inter_500Medium" },
        }}
      />
      {children}
    </Stack>
  );
}
