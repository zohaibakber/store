import { useAtomValue } from "@effect/atom-react";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import {
  minuteClockAtom,
  useCatalogCategories,
  useCatalogProductSearch,
  useCommandExecution,
  useInventorySyncStatus,
  usePendingRowIds,
  type CatalogProductSearchResult,
} from "@store/inventory-react";
import { useRouter } from "expo-router";
import * as React from "react";
import { StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

import { colors, space } from "@/theme/tokens";
import { Text } from "@/ui/text";

import { ActionButton } from "../action-button";
import { EmptyState, ListSkeleton, RowSeparator } from "../list-states";
import { SCAN_FAB_CLEARANCE } from "../scan-fab";
import { unsyncedOperationId } from "../sync/pending";
import { ProductRow } from "./product-row";
import {
  attentionLabel,
  matchesStockFilter,
  onHandOf,
  productSubtitle,
  stockAttention,
  type StockFilter,
} from "./stock-state";

const STOCK_SEARCH_LIMIT = 200;

type StockItem = CatalogProductSearchResult;

const keyOf = (item: StockItem) => item.product.id;

export function StockList({
  query,
  filter,
  refreshing,
  onRefresh,
  onScroll,
}: {
  readonly query: string;
  readonly filter: StockFilter;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  readonly onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}) {
  const { push } = useRouter();
  const search = useCatalogProductSearch(query, STOCK_SEARCH_LIMIT);
  const categories = useCatalogCategories();
  const now = useAtomValue(minuteClockAtom);
  const execution = useCommandExecution();
  const syncStatus = useInventorySyncStatus();
  const pendingOperation = unsyncedOperationId(execution, syncStatus);
  const pendingProducts = usePendingRowIds("product");

  const tracksPacks = React.useMemo(
    () => new Map(categories.data.map((category) => [category.id, category.tracksPacks])),
    [categories.data],
  );
  const items = React.useMemo(
    () =>
      filter === "all"
        ? search.data
        : search.data.filter((item) => matchesStockFilter(item.stock, filter, now)),
    [filter, now, search.data],
  );

  const openProduct = React.useCallback(
    (productId: string) => push({ pathname: "/stock/[productId]", params: { productId } }),
    [push],
  );
  const openScan = () => push("/scan");

  const renderItem = ({ item }: ListRenderItemInfo<StockItem>) => {
    const { product, stock } = item;
    const onHand = onHandOf(
      stock.onHandUnits,
      product.unitsPerPack,
      tracksPacks.get(product.categoryId) ?? true,
    );
    const attention = stockAttention(stock, now);
    return (
      <ProductRow
        id={product.id}
        name={product.name}
        subtitle={productSubtitle(product)}
        onHandValue={onHand.value}
        onHandUnit={onHand.unit}
        attention={attention === null ? null : attentionLabel(attention)}
        pending={
          pendingProducts.has(product.id) ||
          (pendingOperation !== null && product.operationId === pendingOperation)
        }
        onOpen={openProduct}
      />
    );
  };

  const searching = query.trim().length > 0 || filter !== "all";
  const empty = search.isLoading ? (
    <ListSkeleton label="Loading stock" />
  ) : searching ? (
    <EmptyState
      title="No matches"
      body={
        filter === "all"
          ? "Nothing in stock matches that search."
          : "No products in these results need attention."
      }
    />
  ) : (
    <EmptyState
      title="No products yet"
      body="Scan a pack to add your first product."
      action={<ActionButton label="Scan a pack" onPress={openScan} />}
    />
  );
  const footer =
    search.data.length >= STOCK_SEARCH_LIMIT ? (
      <Text size="xs" tone="muted" style={styles.footer}>
        Showing the first {STOCK_SEARCH_LIMIT} products. Search to find others.
      </Text>
    ) : null;

  return (
    <View style={styles.list}>
      <FlashList
        contentContainerStyle={styles.content}
        data={items}
        ItemSeparatorComponent={RowSeparator}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={keyOf}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        onRefresh={onRefresh}
        onScroll={onScroll}
        refreshing={refreshing}
        renderItem={renderItem}
        scrollEventThrottle={16}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: colors.ground,
  },
  content: {
    paddingBottom: SCAN_FAB_CLEARANCE + space[4],
  },
  footer: {
    paddingHorizontal: space[4],
    paddingVertical: space[4],
    textAlign: "center",
  },
});
