import "@/inventory/polyfills";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as React from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useSession } from "@/auth";
import { MobileInventoryProvider } from "@/inventory";
import { ScanDraftsProvider } from "@/scan";
import { colors } from "@/theme/tokens";

void SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const session = useSession();
  const loading = session.status === "loading";
  React.useEffect(() => {
    if (!loading) SplashScreen.hide();
  }, [loading]);
  const signedIn = session.status === "signedIn";
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.ground },
      }}
    >
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="stock/[productId]" />
        <Stack.Screen name="sales/[invoiceId]" />
        <Stack.Screen name="settings" />
        <Stack.Screen
          name="scan"
          options={{
            presentation: "fullScreenModal",
            animation: "fade",
            contentStyle: { backgroundColor: colors.camera },
          }}
        />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <AuthProvider>
          <MobileInventoryProvider>
            <ScanDraftsProvider>
              <RootNavigator />
            </ScanDraftsProvider>
          </MobileInventoryProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
