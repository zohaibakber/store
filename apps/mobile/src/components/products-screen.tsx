import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { useDeferredValue, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";

import { InventoryFabAnchor } from "@/components/inventory-fab-anchor";
import { ProductRow } from "@/components/product-row";
import { ProductSearchField } from "@/components/product-search-field";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, ButtonIcon, ButtonText } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import {
  productStatusView,
  useProductActions,
  useProductData,
  useProductStatus,
} from "@/features/products/products-provider";
import { scrollInset } from "@/hooks/use-overlay-insets";
import { formatPrice } from "@/lib/inventory-snapshot";
import type { MobileProduct } from "@/lib/inventory-types";
import { filterCatalog, STOCK_FILTERS, type StockFilter } from "@/lib/product-catalog";
import { useColors } from "@/theme/colors";

const keyExtractor = (item: MobileProduct) => item.id;

const renderProduct = ({ item }: ListRenderItemInfo<MobileProduct>) => (
  <ProductRow
    aisle={item.aisle}
    category={item.category}
    details={item.details}
    id={item.id}
    name={item.name}
    stock={item.stock}
    stockLabel={item.stockLabel}
    unitPriceLabel={formatPrice(item.unitPrice)}
    visible={item.visible}
  />
);

export function ProductsScreen() {
  const { products } = useProductData();
  const { loading, refreshing, error } = productStatusView(useProductStatus());
  const { refresh } = useProductActions();
  const colors = useColors();
  const scrollBottom = scrollInset("nav-and-actions");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StockFilter>("all");
  const deferredQuery = useDeferredValue(query);
  const filtered = useMemo(
    () => filterCatalog(products, deferredQuery, filter),
    [deferredQuery, filter, products],
  );
  const narrowed = Boolean(query) || filter !== "all";

  const header = (
    <View style={styles.header}>
      <ProductSearchField onChangeText={setQuery} query={query} />

      <ScrollView
        contentContainerStyle={styles.filters}
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
      >
        {STOCK_FILTERS.map((option) => (
          <Chip
            key={option.value}
            isSelected={filter === option.value}
            onPress={() => setFilter(option.value)}
          >
            {option.label}
          </Chip>
        ))}
      </ScrollView>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Inventory may be out of date</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <AlertAction>
            <Button onPress={() => void refresh()} size="sm" variant="outline">
              <ButtonIcon name="refresh" />
              <ButtonText>Retry</ButtonText>
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      <View style={styles.count}>
        <Text tone="muted" variant="caption">
          {filtered.length} {filtered.length === 1 ? "product" : "products"}
        </Text>
        {refreshing ? <Spinner tone="muted" /> : null}
      </View>
    </View>
  );

  const empty = loading ? (
    <View style={styles.loading}>
      <Spinner tone="muted" />
      <Text tone="muted" variant="caption">
        Syncing products…
      </Text>
    </View>
  ) : (
    <Empty>
      <EmptyMedia name={narrowed ? "search" : "box"} />
      <EmptyTitle>{narrowed ? "No matching products" : "No products yet"}</EmptyTitle>
      <EmptyDescription>
        {narrowed
          ? "Try a broader search, or another stock filter."
          : "Create a product, or scan a label to fill one in."}
      </EmptyDescription>
      {narrowed ? (
        <EmptyContent>
          <Button
            onPress={() => {
              setQuery("");
              setFilter("all");
            }}
            size="sm"
            variant="outline"
          >
            <ButtonText>Clear filters</ButtonText>
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <FlashList
        contentContainerStyle={{ paddingBottom: scrollBottom }}
        contentInsetAdjustmentBehavior="automatic"
        data={filtered}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={keyExtractor}
        ListEmptyComponent={empty}
        ListHeaderComponent={header}
        refreshControl={
          <RefreshControl
            colors={[colors.foreground]}
            onRefresh={() => void refresh()}
            progressBackgroundColor={colors.card}
            refreshing={refreshing}
            tintColor={colors.mutedForeground}
          />
        }
        renderItem={renderProduct}
      />
      <InventoryFabAnchor />
    </View>
  );
}

export default ProductsScreen;

const styles = StyleSheet.create({
  count: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between" },
  filters: { gap: 8, paddingVertical: 2 },
  header: { gap: 12, paddingBottom: 12, paddingHorizontal: 16, paddingTop: 8 },
  loading: { alignItems: "center", gap: 12, paddingVertical: 64 },
  root: { flex: 1 },
});
