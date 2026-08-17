import { useClerk, useUser } from "@clerk/expo";
import { Button, FieldGroup, Host, ListItem, Switch, Text } from "@expo/ui";
import Constants from "expo-constants";
import { router } from "expo-router";
import { Alert, StyleSheet, Text as RNText, View } from "react-native";

import {
  useProductActions,
  useProductData,
  useProductStatus,
} from "@/features/products/products-provider";
import { resetProductsSession } from "@/lib/products";
import { useAppColorScheme, setAppColorScheme } from "@/theme/appearance";
import { colors, cssColor } from "@/theme/colors";

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

export default function SettingsScreen() {
  const { user } = useUser();
  const { signOut: clerkSignOut } = useClerk();
  const colorScheme = useAppColorScheme();
  const { products } = useProductData();
  const { refreshing, error, lastUpdatedAt } = useProductStatus();
  const { refresh } = useProductActions();
  const userName = user?.fullName || user?.primaryEmailAddress?.emailAddress || "Tabaaq user";
  const userEmail = user?.primaryEmailAddress?.emailAddress;
  const version = Constants.expoConfig?.version ?? "0.1.0";
  const syncDetail = lastUpdatedAt
    ? `${products.length} products synced at ${timeFormatter.format(lastUpdatedAt)}`
    : "Inventory has not synced yet.";

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
    <View style={[styles.root, { backgroundColor: colors.systemGroupedBackground }]}>
      <Host
        colorScheme={colorScheme}
        seedColor={colors.systemBlue}
        style={styles.host}
        useViewportSizeMeasurement
      >
        <FieldGroup style={{ backgroundColor: colors.systemGroupedBackground }}>
          <FieldGroup.Section title="Account">
            <ListItem supportingText={userEmail}>{userName}</ListItem>
          </FieldGroup.Section>

          <FieldGroup.Section title="Preferences">
            <ListItem
              supportingText="Follow a dark appearance"
              trailing={
                <Switch
                  onValueChange={(selected) => setAppColorScheme(selected ? "dark" : "light")}
                  value={colorScheme === "dark"}
                />
              }
            >
              Dark appearance
            </ListItem>
          </FieldGroup.Section>

          <FieldGroup.Section title="Inventory sync">
            <ListItem
              supportingText={`${error ? "Needs attention" : "Up to date"} · ${syncDetail}`}
            >
              Sync status
            </ListItem>
            <ListItem onPress={() => void refresh()} supportingText="Refresh local inventory now">
              {refreshing ? "Syncing…" : "Sync now"}
            </ListItem>
          </FieldGroup.Section>

          <FieldGroup.Section title="About">
            <ListItem
              trailing={
                <RNText selectable style={{ color: colors.secondaryLabel }}>
                  {version}
                </RNText>
              }
            >
              App version
            </ListItem>
          </FieldGroup.Section>

          <FieldGroup.Section>
            <Button label="Sign out" onPress={signOut} variant="outlined" />
            <Text
              textStyle={{
                color: cssColor(colors.label),
                fontSize: 12,
                lineHeight: 18,
                textAlign: "center",
              }}
            >
              Tabaaq keeps your inventory available offline and syncs changes when connected.
            </Text>
          </FieldGroup.Section>
        </FieldGroup>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  root: { flex: 1 },
});
