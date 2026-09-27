import { StyleSheet, View } from "react-native";

import { useSyncRefresh } from "@/features/sync/sync-now";
import { SyncOverview } from "@/features/sync/sync-overview";
import { AccountAvatar, TabHeader } from "@/features/tab-header";
import { colors } from "@/theme/tokens";

export default function SyncScreen() {
  const { syncNow } = useSyncRefresh();
  return (
    <View style={styles.screen}>
      <TabHeader title="Sync" trailing={<AccountAvatar />} />
      <SyncOverview syncNow={syncNow} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ground,
  },
});
