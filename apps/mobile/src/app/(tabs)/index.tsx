import { useCatalogIsReady } from "@store/inventory-react";
import * as React from "react";
import { StyleSheet, View } from "react-native";

import { ListSkeleton } from "@/features/list-states";
import { ScanFab, useScanFabExtension } from "@/features/scan-fab";
import { FilterChips } from "@/features/stock/filter-chips";
import { SearchField } from "@/features/stock/search-field";
import { StockList } from "@/features/stock/stock-list";
import type { StockFilter } from "@/features/stock/stock-state";
import { useSyncRefresh } from "@/features/sync/sync-now";
import { AccountAvatar, TabHeader } from "@/features/tab-header";
import { colors, space } from "@/theme/tokens";

export default function StockScreen() {
  const ready = useCatalogIsReady();
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<StockFilter>("all");
  const deferredQuery = React.useDeferredValue(query);
  const { extended, onScroll } = useScanFabExtension();
  const { refreshing, refresh } = useSyncRefresh();

  return (
    <View style={styles.screen}>
      <TabHeader title="Stock" trailing={<AccountAvatar />} />
      <View style={styles.controls}>
        <SearchField
          empty={query.length === 0}
          onChangeText={setQuery}
          placeholder="Search products"
        />
        <FilterChips onChange={setFilter} value={filter} />
      </View>
      {ready ? (
        <StockList
          filter={filter}
          onRefresh={refresh}
          onScroll={onScroll}
          query={deferredQuery}
          refreshing={refreshing}
        />
      ) : (
        <ListSkeleton label="Opening stock" />
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
  controls: {
    gap: space[2],
    paddingBottom: space[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
});
