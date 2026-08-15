import { useClerk, useUser } from "@clerk/expo";
import Constants from "expo-constants";
import { router } from "expo-router";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { Separator } from "heroui-native/separator";
import { Switch } from "heroui-native/switch";
import { Alert, ScrollView, Text, View } from "react-native";
import { Uniwind, useUniwind } from "uniwind";

import { Brand } from "@/components/brand";
import { useProducts } from "@/features/products/products-provider";
import { resetProductsSession } from "@/lib/products";

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

export default function SettingsScreen() {
  const { user } = useUser();
  const { signOut: clerkSignOut } = useClerk();
  const { theme } = useUniwind();
  const { products, refreshing, error, lastUpdatedAt, refresh } = useProducts();
  const userName = user?.fullName || user?.primaryEmailAddress?.emailAddress || "Tabaaq user";
  const userEmail = user?.primaryEmailAddress?.emailAddress;
  const initial = (userName || "T").trim().slice(0, 1).toLocaleUpperCase();
  const version = Constants.expoConfig?.version ?? "0.1.0";

  const signOut = () => {
    Alert.alert("Sign out?", "You can sign back in at any time.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => {
          void clerkSignOut().finally(() => {
            resetProductsSession();
            router.replace("/auth");
          });
        },
      },
    ]);
  };

  return (
    <ScrollView
      className="bg-background"
      contentContainerClassName="gap-6 px-4 pb-10 pt-3"
      contentInsetAdjustmentBehavior="automatic"
    >
      <Brand />

      <View className="gap-3">
        <SectionLabel>Account</SectionLabel>
        <Card variant="default">
          <Card.Body className="flex-row items-center gap-3 p-4">
            <View className="size-12 items-center justify-center rounded-full bg-foreground">
              <Text className="text-base font-medium text-background">{initial}</Text>
            </View>
            <View className="min-w-0 flex-1 gap-0.5">
              <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                {userName}
              </Text>
              <Text className="text-xs font-normal text-muted" numberOfLines={1}>
                {userEmail}
              </Text>
            </View>
          </Card.Body>
        </Card>
      </View>

      <View className="gap-3">
        <SectionLabel>Preferences</SectionLabel>
        <Card variant="default">
          <Card.Body className="p-0">
            <View className="flex-row items-center gap-4 px-4 py-3.5">
              <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-sm font-medium text-foreground">Dark appearance</Text>
                <Text className="text-xs font-normal text-muted">
                  Use the desktop app’s dark neutral theme
                </Text>
              </View>
              <Switch
                accessibilityLabel="Dark appearance"
                isSelected={theme === "dark"}
                onSelectedChange={(selected) => Uniwind.setTheme(selected ? "dark" : "light")}
              />
            </View>
          </Card.Body>
        </Card>
      </View>

      <View className="gap-3">
        <SectionLabel>Inventory sync</SectionLabel>
        <Card variant="default">
          <Card.Body className="p-0">
            <View className="gap-1 px-4 py-3.5">
              <View className="flex-row items-center justify-between gap-4">
                <Text className="text-sm font-medium text-foreground">Sync status</Text>
                <Text className={`text-xs font-medium ${error ? "text-danger" : "text-success"}`}>
                  {error ? "Needs attention" : "Up to date"}
                </Text>
              </View>
              <Text className="text-xs leading-5 font-normal text-muted">
                {lastUpdatedAt
                  ? `${products.length} products synced at ${timeFormatter.format(lastUpdatedAt)}`
                  : "Inventory has not synced yet."}
              </Text>
            </View>
            <Separator />
            <View className="px-4 py-3.5">
              <Button
                className="w-full"
                isDisabled={refreshing}
                variant="secondary"
                onPress={() => void refresh()}
              >
                {refreshing ? "Syncing…" : "Sync now"}
              </Button>
            </View>
          </Card.Body>
        </Card>
      </View>

      <View className="gap-3">
        <SectionLabel>About</SectionLabel>
        <Card variant="default">
          <Card.Body className="p-0">
            <View className="flex-row items-center justify-between gap-4 px-4 py-3.5">
              <Text className="text-sm font-medium text-foreground">App version</Text>
              <Text className="font-mono text-xs text-muted">{version}</Text>
            </View>
          </Card.Body>
        </Card>
      </View>

      <Button className="w-full" variant="danger-soft" onPress={signOut}>
        Sign out
      </Button>
    </ScrollView>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="px-1 text-xs font-medium tracking-wide text-muted uppercase">{children}</Text>
  );
}
