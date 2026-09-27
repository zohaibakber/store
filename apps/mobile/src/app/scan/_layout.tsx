import { Stack } from "expo-router";

import { ScanDraftsProvider } from "@/scan";
import { colors } from "@/theme/tokens";

export default function ScanLayout() {
  return (
    <ScanDraftsProvider>
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
    </ScanDraftsProvider>
  );
}
