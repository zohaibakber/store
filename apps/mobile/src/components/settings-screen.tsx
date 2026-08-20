import Constants from "expo-constants";
import { Alert as NativeAlert, ScrollView, StyleSheet, View } from "react-native";

import { Icon } from "@/components/ui/icon";
import { Row, RowGroup, RowValue } from "@/components/ui/row";
import { Spinner } from "@/components/ui/spinner";
import { SectionTitle, Text } from "@/components/ui/text";
import {
  productStatusView,
  useProductActions,
  useProductData,
  useProductStatus,
} from "@/features/products/products-provider";
import { useOverlayInsets } from "@/hooks/use-overlay-insets";
import { mobileApplicationId } from "@/lib/auth-client";
import { useMobileAuth } from "@/lib/auth-provider";
import { useColors } from "@/theme/colors";

const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export function SettingsScreen() {
  const {
    state,
    actions: { signOut },
  } = useMobileAuth();
  const { products } = useProductData();
  const { refreshing, error, lastUpdatedAt } = productStatusView(useProductStatus());
  const { refresh } = useProductActions();
  const colors = useColors();
  const { scrollBottom } = useOverlayInsets();
  const authenticated = state._tag === "Authenticated";
  const version = Constants.expoConfig?.version ?? "0.1.0";

  const confirmSignOut = () => {
    NativeAlert.alert("Sign out?", "Tabaaq needs an account, so this returns you to sign-in.", [
      { style: "cancel", text: "Cancel" },
      { onPress: () => void signOut(), style: "destructive", text: "Sign out" },
    ]);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: scrollBottom }]}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={styles.section}>
          <SectionTitle>Account</SectionTitle>
          <RowGroup>
            <Row
              leading={<Icon name="person" size={18} tone="muted" />}
              supporting={authenticated ? state.workspace.user.email : undefined}
              title={authenticated ? state.workspace.user.name : "Signed out"}
            />
            {authenticated ? (
              <Row
                leading={<Icon name="logout" size={18} tone="destructive" />}
                onPress={confirmSignOut}
                title="Sign out"
                tone="destructive"
              />
            ) : null}
          </RowGroup>
        </View>

        <View style={styles.section}>
          <SectionTitle>Inventory</SectionTitle>
          <RowGroup>
            <Row
              leading={<Icon name="bolt" size={18} tone={error ? "destructive" : "muted"} />}
              supporting={
                lastUpdatedAt
                  ? `${products.length} products, synced at ${timeFormatter.format(lastUpdatedAt)}`
                  : "Not synced yet."
              }
              title={error ? "Needs attention" : "Up to date"}
            />
            <Row
              leading={<Icon name="refresh" size={18} tone="muted" />}
              onPress={() => void refresh()}
              supporting="Pull the latest inventory now"
              title={refreshing ? "Syncing…" : "Sync now"}
              trailing={refreshing ? <Spinner tone="muted" /> : undefined}
            />
          </RowGroup>
        </View>

        <View style={styles.section}>
          <SectionTitle>About</SectionTitle>
          <RowGroup>
            <Row
              leading={<Icon name="info" size={18} tone="muted" />}
              title="Version"
              trailing={<RowValue>{version}</RowValue>}
            />
            <Row
              leading={<Icon name="tag" size={18} tone="muted" />}
              supporting={mobileApplicationId}
              title={__DEV__ ? "Development build" : "Production build"}
            />
          </RowGroup>
        </View>

        <Text style={styles.footnote} tone="muted" variant="caption">
          Inventory stays available offline and syncs when you reconnect.
        </Text>
      </ScrollView>
    </View>
  );
}

export default SettingsScreen;

const styles = StyleSheet.create({
  content: { gap: 24, paddingHorizontal: 16, paddingTop: 8 },
  footnote: { paddingHorizontal: 4, textAlign: "center" },
  root: { flex: 1 },
  section: { gap: 8 },
});
