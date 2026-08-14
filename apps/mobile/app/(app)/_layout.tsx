import { useAuth, useUser } from "@clerk/expo";
import { Redirect } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useThemeColor } from "heroui-native";

import { LoadingScreen } from "@/components/loading-screen";
import { ProductsProvider } from "@/features/products/products-provider";

export default function AppLayout() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const [background, foreground, muted, indicator, separator] = useThemeColor([
    "background",
    "foreground",
    "muted",
    "surface-tertiary",
    "separator",
  ]);

  if (!isLoaded) return <LoadingScreen />;
  if (!isSignedIn || !user) return <Redirect href="/auth" />;

  return (
    <ProductsProvider userId={user.id}>
      <NativeTabs
        backBehavior="history"
        backgroundColor={background}
        badgeBackgroundColor={foreground}
        disableTransparentOnScrollEdge
        iconColor={{ default: muted, selected: foreground }}
        indicatorColor={indicator}
        labelStyle={{
          default: { color: muted, fontFamily: "Inter_500Medium", fontSize: 12 },
          selected: { color: foreground, fontFamily: "Inter_500Medium", fontSize: 12 },
        }}
        labelVisibilityMode="labeled"
        rippleColor={separator}
        shadowColor={separator}
        tintColor={foreground}
      >
        <NativeTabs.Trigger name="home">
          <NativeTabs.Trigger.Icon md="home" sf={{ default: "house", selected: "house.fill" }} />
          <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="products">
          <NativeTabs.Trigger.Icon
            md="inventory_2"
            sf={{ default: "shippingbox", selected: "shippingbox.fill" }}
          />
          <NativeTabs.Trigger.Label>Products</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="settings">
          <NativeTabs.Trigger.Icon
            md="settings"
            sf={{ default: "gearshape", selected: "gearshape.fill" }}
          />
          <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    </ProductsProvider>
  );
}
