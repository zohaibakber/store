import { Stack } from "expo-router";
import type { ReactNode } from "react";

import { useColors } from "@/theme/colors";
import { typography } from "@/theme/typography";

/**
 * One file for both platforms. `headerLargeTitle` is iOS-only; Android ignores it.
 */
export function AppStack({ title, children }: { title: string; children?: ReactNode }) {
  const colors = useColors();
  const titleStyle = {
    color: colors.foreground,
    fontFamily: typography.subheading.fontFamily,
    fontSize: typography.subheading.fontSize,
  } as const;

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.background },
        headerBackTitle: "Back",
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerTitleStyle: titleStyle,
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          // The root of a tab. Selecting a tab is a switch, not a push, so it
          // must never slide in from the side.
          animation: "none",
          headerLargeTitle: true,
          headerLargeTitleShadowVisible: false,
          headerLargeTitleStyle: {
            color: colors.foreground,
            fontFamily: typography.title.fontFamily,
            fontSize: typography.title.fontSize,
          },
          title,
        }}
      />
      {children}
    </Stack>
  );
}
