import { Stack } from "expo-router";
import { StyleSheet, View } from "react-native";

import { useSession } from "@/auth";
import { detailHeaderOptions } from "@/features/detail-header";
import { SettingsList } from "@/features/settings/settings-list";
import { colors } from "@/theme/tokens";

const signedOut = () => Promise.resolve();

export default function SettingsScreen() {
  const session = useSession();
  const account =
    session.status === "signedIn"
      ? { email: session.email, organizationName: session.organizationName }
      : session.status === "needsOrganization"
        ? { email: session.email, organizationName: null }
        : null;
  const signOut =
    session.status === "signedIn" || session.status === "needsOrganization"
      ? session.signOut
      : signedOut;
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ ...detailHeaderOptions, title: "Settings" }} />
      {account === null ? null : <SettingsList account={account} onSignOut={signOut} />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ground,
  },
});
