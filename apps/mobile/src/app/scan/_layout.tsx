import { Stack } from "expo-router";

import { colors } from "@/theme/tokens";

export default function ScanLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.ground },
      }}
    >
      <Stack.Screen
        name="index"
        options={{ contentStyle: { backgroundColor: colors.camera }, animation: "fade" }}
      />
      <Stack.Screen name="review" />
      <Stack.Screen name="batch" />
      <Stack.Screen name="drafts" />
    </Stack>
  );
}
