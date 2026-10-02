import { StyleSheet, View } from "react-native";

import { SyncOverview } from "@/features/sync/sync-overview";
import { AccountAvatar, TabHeader } from "@/features/tab-header";
import { colors } from "@/theme/tokens";

export default function SyncScreen() {
  return (
    <View style={styles.screen}>
      <TabHeader title="Sync" trailing={<AccountAvatar />} />
      <SyncOverview />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ground,
  },
});
