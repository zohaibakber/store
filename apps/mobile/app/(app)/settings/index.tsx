import { useClerk, useUser } from "@clerk/expo";
import Constants from "expo-constants";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View, type ColorValue } from "react-native";

import {
  useProductActions,
  useProductData,
  useProductStatus,
} from "@/features/products/products-provider";
import { useThemeColor } from "@/hooks/use-theme-color";
import { mobileApplicationId } from "@/lib/auth-client";
import { resetProductsSession } from "@/lib/products";
import { setAppColorScheme, useAppColorScheme } from "@/theme/appearance";

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
  const [background, surface, foreground, muted, separator, accent, danger] = useThemeColor([
    "background",
    "surface",
    "foreground",
    "muted",
    "separator",
    "accent",
    "danger",
  ]);
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
      <SettingsSection title="Account">
        <SettingsRow
          detail={userEmail}
          surface={surface}
          separator={separator}
          title={userName}
          titleColor={foreground}
          detailColor={muted}
        />
      </SettingsSection>

      <SettingsSection title="Preferences">
        <SettingsRow
          detail="Follow a dark appearance"
          surface={surface}
          separator={separator}
          title="Dark appearance"
          titleColor={foreground}
          detailColor={muted}
          trailing={
            <Switch
              onValueChange={(selected) => setAppColorScheme(selected ? "dark" : "light")}
              thumbColor={colorScheme === "dark" ? accent : undefined}
              trackColor={{ false: muted, true: accent }}
              value={colorScheme === "dark"}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Inventory sync">
        <SettingsRow
          detail={`${error ? "Needs attention" : "Up to date"} · ${syncDetail}`}
          surface={surface}
          separator={separator}
          title="Sync status"
          titleColor={foreground}
          detailColor={muted}
        />
        <SettingsRow
          detail="Refresh local inventory now"
          onPress={() => void refresh()}
          surface={surface}
          separator={separator}
          title={refreshing ? "Syncing…" : "Sync now"}
          titleColor={foreground}
          detailColor={muted}
        />
      </SettingsSection>

      <SettingsSection title="About">
        <SettingsRow
          surface={surface}
          separator={separator}
          title="App version"
          titleColor={foreground}
          trailing={
            <Text selectable style={[styles.trailing, { color: muted }]}>
              {version}
            </Text>
          }
        />
        <SettingsRow
          detail={mobileApplicationId}
          surface={surface}
          separator={separator}
          title={__DEV__ ? "Development build" : "Production build"}
          titleColor={foreground}
          detailColor={muted}
        />
      </SettingsSection>

      <Pressable
        accessibilityRole="button"
        onPress={signOut}
        style={({ pressed }) => [
          styles.signOut,
          { backgroundColor: surface, borderColor: separator, opacity: pressed ? 0.72 : 1 },
        ]}
      >
        <Text style={[styles.signOutLabel, { color: danger }]}>Sign out</Text>
      </Pressable>
      <Text style={[styles.footnote, { color: muted }]}>
        Tabaaq keeps your inventory available offline and syncs changes when connected.
      </Text>
    </ScrollView>
  );
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  const muted = useThemeColor("muted");
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: muted }]}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function SettingsRow({
  detail,
  detailColor,
  onPress,
  separator,
  surface,
  title,
  titleColor,
  trailing,
}: {
  detail?: string;
  detailColor?: ColorValue;
  onPress?: () => void;
  separator: ColorValue;
  surface: ColorValue;
  title: string;
  titleColor: ColorValue;
  trailing?: ReactNode;
}) {
  const content = (
    <View style={[styles.row, { backgroundColor: surface, borderColor: separator }]}>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: titleColor }]}>{title}</Text>
        {detail ? (
          <Text selectable style={[styles.rowDetail, { color: detailColor }]}>
            {detail}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: 24, paddingBottom: 112, paddingHorizontal: 16, paddingTop: 12 },
  footnote: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
  row: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowCopy: { flex: 1, gap: 2, minWidth: 0 },
  rowDetail: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  rowTitle: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20 },
  section: { gap: 8 },
  sectionBody: { gap: 8 },
  sectionTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 4,
    textTransform: "uppercase",
  },
  signOut: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    height: 48,
    justifyContent: "center",
  },
  signOutLabel: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20 },
  trailing: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
});
