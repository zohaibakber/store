import { FlashList, type ListRenderItem } from "@shopify/flash-list";
import { useDeferredValue, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { InventoryFabAnchor } from "@/components/inventory-fab-anchor";
import { ProductRow } from "@/components/product-row";
import { ProductSearchField } from "@/components/product-search-field";
import { IconSymbol } from "@/components/symbol";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { Spinner } from "@/components/ui/spinner";
import {
  useProductActions,
  useProductData,
  useProductStatus,
} from "@/features/products/products-provider";
import { useThemeColor } from "@/hooks/use-theme-color";
import { filterCatalog, STOCK_FILTERS, type StockFilter } from "@/lib/product-catalog";
import type { MobileProduct } from "@/lib/products";

const keyExtractor = (item: MobileProduct) => item.id;
const renderProduct: ListRenderItem<MobileProduct> = ({ item }) => (
  <ProductRow
    aisle={item.aisle}
    category={item.category}
    details={item.details}
    name={item.name}
    stock={item.stock}
    stockLabel={item.stockLabel}
    unitPrice={item.unitPrice}
    visible={item.visible}
  />
);

export function ProductsScreen() {
  const { products } = useProductData();
  const { loading, refreshing, error } = useProductStatus();
  const { refresh } = useProductActions();
  const [query, setQuery] = useState("");
  const [searchResetKey, setSearchResetKey] = useState(0);
  const [filter, setFilter] = useState<StockFilter>("all");
  const deferredQuery = useDeferredValue(query);
  const [foreground, muted, background] = useThemeColor(["foreground", "muted", "background"]);
  const filtered = useMemo(
    () => filterCatalog(products, deferredQuery, filter),
    [deferredQuery, filter, products],
  );

  const header = (
    <View style={styles.header}>
      <ProductSearchField onChangeText={setQuery} query={query} resetKey={searchResetKey} />

      <ScrollView
        contentContainerStyle={styles.filters}
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
      >
        {STOCK_FILTERS.map((option) => (
          <ChoiceChip
            key={option.value}
            onPress={() => setFilter(option.value)}
            selected={filter === option.value}
          >
            {option.label}
          </ChoiceChip>
        ))}
      </ScrollView>

      {error ? (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Inventory may be out of date</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
          <Button size="sm" variant="ghost" onPress={() => void refresh()}>
            Retry
          </Button>
        </Alert>
      ) : null}

      <View style={styles.summary}>
        <Text selectable style={[styles.summaryText, { color: muted }]}>
          {filtered.length} {filtered.length === 1 ? "product" : "products"}
        </Text>
        {refreshing ? <Spinner size="sm" /> : null}
      </View>
    </View>
  );

  const empty = loading ? (
    <View style={styles.loading}>
      <Spinner />
      <Text style={[styles.body, { color: muted }]}>Syncing products…</Text>
    </View>
  ) : (
    <View style={styles.empty}>
      <IconSymbol name={query ? "magnifyingglass" : "shippingbox"} size={30} tintColor={muted} />
      <Text style={[styles.bodyMedium, { color: foreground }]}>
        {query || filter !== "all" ? "No matching products" : "No products yet"}
      </Text>
      <Text style={[styles.emptyText, { color: muted }]}>
        {query || filter !== "all"
          ? "Try a broader search or another stock filter."
          : "Use the + button to create a product or the camera to scan a label."}
      </Text>
      {query || filter !== "all" ? (
        <Button
          size="sm"
          variant="secondary"
          onPress={() => {
            setQuery("");
            setFilter("all");
            setSearchResetKey((value) => value + 1);
          }}
        >
          Clear filters
        </Button>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: background }]}>
      <FlashList
        contentContainerStyle={styles.listContent}
        contentInsetAdjustmentBehavior="automatic"
        data={filtered}
        keyExtractor={keyExtractor}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={empty}
        ListHeaderComponent={header}
        onRefresh={refresh}
        refreshing={refreshing}
        renderItem={renderProduct}
        style={styles.list}
      />
      <InventoryFabAnchor />
    </View>
  );
}

export default ProductsScreen;

const styles = StyleSheet.create({
  body: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
  bodyMedium: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20 },
  empty: {
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 32,
    paddingVertical: 48,
  },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 20,
    textAlign: "center",
  },
  filters: { gap: 8 },
  header: { gap: 16, paddingBottom: 8, paddingHorizontal: 16, paddingTop: 12 },
  list: { flex: 1 },
  listContent: { paddingBottom: 160 },
  loading: { alignItems: "center", gap: 12, paddingVertical: 64 },
  root: { flex: 1 },
  summary: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  summaryText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    letterSpacing: 0.5,
    lineHeight: 16,
    textTransform: "uppercase",
  },
});
