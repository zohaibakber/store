import { Stack } from "expo-router";

import { AppStack } from "@/components/app-stack";

export default function ProductsLayout() {
  return (
    <AppStack title="Products">
      <Stack.Screen
        name="new"
        options={{
          headerLargeTitle: false,
          presentation: "modal",
          title: "New product",
        }}
      />
      <Stack.Screen
        name="scan"
        options={{
          headerLargeTitle: false,
          title: "Scan product",
        }}
      />
    </AppStack>
  );
}
