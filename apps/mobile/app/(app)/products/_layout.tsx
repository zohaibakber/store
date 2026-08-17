import { Stack } from "expo-router";

import { AppStack } from "@/components/app-stack";

export default function ProductsLayout() {
  return (
    <AppStack title="Products">
      <Stack.Screen
        name="new"
        options={{
          animation: "default",
          headerLargeTitle: false,
          headerShown: true,
          presentation: "modal",
          title: "New product",
        }}
      />
      <Stack.Screen
        name="scan"
        options={{
          animation: "default",
          headerLargeTitle: false,
          headerShown: true,
          title: "Scan product",
        }}
      />
    </AppStack>
  );
}
