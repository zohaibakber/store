import { useClerk, useUser } from "@clerk/expo";
import { ListItem, Text as UiText } from "@expo/ui";
import Constants from "expo-constants";
import { router } from "expo-router";
import { Alert, ScrollView, StyleSheet, Text } from "react-native";

import { AppList } from "@/components/app-list";
import {
  useProductActions,
  useProductData,
  useProductStatus,
} from "@/features/products/products-provider";
import { useThemeColor } from "@/hooks/use-theme-color";
import { mobileApplicationId } from "@/lib/auth-client";
import { resetProductsSession } from "@/lib/products";
import { cssColor } from "@/theme/colors";

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

export function SettingsScreen() {
  const { user } = useUser();
  const { signOut: clerkSignOut } = useClerk();
  const { products } = useProductData();
  const { refreshing, error, lastUpdatedAt } = useProductStatus();
  const { refresh } = useProductActions();
  const [background, muted, danger] = useThemeColor(["background", "muted", "danger"]);
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
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: background }}
    >
      <Text style={[styles.sectionTitle, { color: muted }]}>Account</Text>
      <AppList>
        <ListItem supportingText={userEmail}>{userName}</ListItem>
      </AppList>

      <Text style={[styles.sectionTitle, { color: muted }]}>Inventory sync</Text>
      <AppList>
        <ListItem supportingText={`${error ? "Needs attention" : "Up to date"} · ${syncDetail}`}>
          Sync status
        </ListItem>
        <ListItem onPress={() => void refresh()} supportingText="Refresh local inventory now">
          {refreshing ? "Syncing…" : "Sync now"}
        </ListItem>
      </AppList>

      <Text style={[styles.sectionTitle, { color: muted }]}>About</Text>
      <AppList>
        <ListItem trailing={<UiText textStyle={{ color: cssColor(muted) }}>{version}</UiText>}>
          App version
        </ListItem>
        <ListItem supportingText={mobileApplicationId}>
          {__DEV__ ? "Development build" : "Production build"}
        </ListItem>
        <ListItem onPress={signOut}>
          <UiText textStyle={{ color: cssColor(danger) }}>Sign out</UiText>
        </ListItem>
      </AppList>

      <Text style={[styles.footnote, { color: muted }]}>
        Tabaaq keeps your inventory available offline and syncs changes when connected.
      </Text>
    </ScrollView>
  );
}

export default SettingsScreen;

const styles = StyleSheet.create({
  content: { gap: 8, paddingBottom: 48, paddingTop: 12 },
  footnote: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 16,
    paddingTop: 16,
    textAlign: "center",
  },
  sectionTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    textTransform: "uppercase",
  },
});
