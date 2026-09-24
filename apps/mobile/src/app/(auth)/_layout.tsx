import { Stack } from "expo-router";
import { View } from "react-native";

import { useSession } from "@/auth";
import { colors } from "@/theme/tokens";

export const unstable_settings = { initialRouteName: "sign-in/index" };

export default function AuthLayout() {
  const session = useSession();
  if (session.status === "loading") {
    return <View style={{ flex: 1, backgroundColor: colors.ground }} />;
  }
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.ground },
      }}
    >
      <Stack.Protected guard={session.status === "signedOut"}>
        <Stack.Screen name="sign-in/index" />
        <Stack.Screen name="sign-in/code" />
        <Stack.Screen name="sign-in/password" />
        <Stack.Screen name="sign-in/create-account" />
      </Stack.Protected>
      <Stack.Protected guard={session.status === "needsOrganization"}>
        <Stack.Screen name="organization" options={{ gestureEnabled: false }} />
      </Stack.Protected>
    </Stack>
  );
}
