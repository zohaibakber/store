import { Stack } from "expo-router";
import type { ReactNode } from "react";

import { useColors } from "@/theme/colors";
import { typography } from "@/theme/typography";

/**
 * Native navigation chrome, painted from the palette: `background` content and
 * header, no shadow, `foreground` titles and back button. The back arrow is
 * deliberately not a platform accent.
 *
 * One file for both platforms. `headerLargeTitle` is an iOS-only prop that
 * Android ignores, which is the whole difference between the two headers — not
 * enough to justify a split.
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
