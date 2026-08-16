import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { FlashList, type ListRenderItem } from "@shopify/flash-list";
import { useDeferredValue, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { AddInventoryActions } from "@/components/add-inventory-actions";
import { Alert, Button, ChoiceChip, Spinner, useThemeColor } from "@/components/mobile-ui";
import { ProductRow } from "@/components/product-row";
import { ProductSearchField } from "@/components/product-search-field";
import {
  useProductActions,
  useProductData,
  useProductStatus,
} from "@/features/products/products-provider";
import type { MobileProduct } from "@/lib/products";

type StockFilter = "all" | "low" | "out" | "hidden";

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
const filters: ReadonlyArray<{ value: StockFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "low", label: "Low stock" },
  { value: "out", label: "Out" },
  { value: "hidden", label: "Hidden" },
];

export default function ProductsScreen() {
  const { products } = useProductData();
  const { loading, refreshing, error } = useProductStatus();
  const { refresh } = useProductActions();
  const [query, setQuery] = useState("");
  const [searchResetKey, setSearchResetKey] = useState(0);
  const [filter, setFilter] = useState<StockFilter>("all");
  const deferredQuery = useDeferredValue(query);
  const [foreground, muted, background, subtle] = useThemeColor([
    "foreground",
    "muted",
    "background",
    "surface-secondary",
  ]);

  const filtered = useMemo(() => {
    const term = deferredQuery.trim().toLocaleLowerCase();
    return products
      .filter((product) => {
        if (filter === "low" && (product.stock === 0 || product.stock > 10)) return false;
        if (filter === "out" && product.stock !== 0) return false;
        if (filter === "hidden" && product.visible) return false;
        if (!term) return true;
        return [
          product.name,
          product.category,
          product.details,
          product.aisle,
          ...product.batches.map((batch) => batch.batchNumber),
        ]
          .filter(Boolean)
          .some((value) => value!.toLocaleLowerCase().includes(term));
      })
      .sort((left, right) => {
        if (!term) return left.name.localeCompare(right.name);
        const leftStarts = left.name.toLocaleLowerCase().startsWith(term);
        const rightStarts = right.name.toLocaleLowerCase().startsWith(term);
        return Number(rightStarts) - Number(leftStarts) || left.name.localeCompare(right.name);
      });
  }, [deferredQuery, filter, products]);

  const header = (
    <View style={styles.header}>
      <ProductSearchField onChangeText={setQuery} query={query} resetKey={searchResetKey} />

      <ScrollView
        contentContainerStyle={styles.filters}
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
      >
        {filters.map((option) => (
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
        <Text style={[styles.summaryText, { color: muted }]}>
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
    <View style={[styles.empty, { backgroundColor: subtle }]}>
      <MaterialIcons color={muted} name={query ? "search-off" : "inventory-2"} size={30} />
      <Text style={[styles.bodyMedium, { color: foreground }]}>
        {query || filter !== "all" ? "No matching products" : "No products yet"}
      </Text>
      <Text style={[styles.emptyText, { color: muted }]}>
        {query || filter !== "all"
          ? "Try a broader search or another stock filter."
          : "Use the add button below to create or scan your first product."}
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
      />
      <AddInventoryActions onRefresh={() => void refresh()} refreshing={refreshing} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
  bodyMedium: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20 },
  empty: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 12,
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
  header: { gap: 16, paddingBottom: 16, paddingTop: 12 },
  listContent: { paddingBottom: 136, paddingHorizontal: 16 },
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
