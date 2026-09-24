import { useCatalogIsReady } from "@store/inventory-react";
import { StyleSheet, View } from "react-native";

import { ListSkeleton } from "@/features/list-states";
import { InvoiceList } from "@/features/sales/invoice-list";
import { ScanFab, useScanFabExtension } from "@/features/scan-fab";
import { useSyncRefresh } from "@/features/sync/sync-now";
import { AccountAvatar, TabHeader } from "@/features/tab-header";
import { colors } from "@/theme/tokens";

export default function SalesScreen() {
  const ready = useCatalogIsReady();
  const { extended, onScroll } = useScanFabExtension();
  const { refreshing, refresh } = useSyncRefresh();
  return (
    <View style={styles.screen}>
      <TabHeader title="Sales" trailing={<AccountAvatar />} />
      {ready ? (
        <InvoiceList onRefresh={refresh} onScroll={onScroll} refreshing={refreshing} />
      ) : (
        <ListSkeleton label="Opening sales" />
      )}
      <ScanFab extended={extended} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ground,
  },
});
