import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { FlashList, type ListRenderItem } from "@shopify/flash-list";
import { useDeferredValue, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { Alert, Button, Chip, Spinner, useThemeColor } from "@/components/mobile-ui";
import { ProductRow } from "@/components/product-row";
import { useProducts } from "@/features/products/products-provider";
import type { MobileProduct } from "@/lib/products";

type StockFilter = "all" | "low" | "out" | "hidden";

const keyExtractor = (item: MobileProduct) => item.id;
const listContentStyle = { paddingBottom: 124, paddingHorizontal: 16 } as const;
const filters: ReadonlyArray<{ value: StockFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "low", label: "Low stock" },
  { value: "out", label: "Out" },
  { value: "hidden", label: "Hidden" },
];

export default function ProductsScreen() {
  const { products, loading, refreshing, error, refresh } = useProducts();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StockFilter>("all");
  const deferredQuery = useDeferredValue(query);
  const [foreground, muted, surface, accent] = useThemeColor([
    "foreground",
    "muted",
    "surface",
    "accent",
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

  const renderItem: ListRenderItem<MobileProduct> = ({ item }) => (
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

  const header = (
    <View className="gap-4 pt-3 pb-4">
      <View
        className="bg-surface h-14 flex-row items-center gap-3 rounded-2xl border border-accent/15 px-4"
        style={{ backgroundColor: surface, elevation: 2 }}
      >
        <MaterialIcons color={accent} name="search" size={22} />
        <TextInput
          accessibilityLabel="Search inventory"
          className="min-w-0 flex-1 text-sm text-foreground"
          onChangeText={setQuery}
          placeholder="Name, category, aisle or batch"
          placeholderTextColor={muted}
          returnKeyType="search"
          value={query}
        />
        {query ? (
          <Pressable
            accessibilityLabel="Clear search"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => setQuery("")}
          >
            <MaterialIcons color={foreground} name="cancel" size={20} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        contentContainerClassName="gap-2"
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
      >
        {filters.map((option) => (
          <Chip
            key={option.value}
            color={filter === option.value ? "accent" : "default"}
            onPress={() => setFilter(option.value)}
          >
            {option.label}
          </Chip>
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

      <View className="flex-row items-center justify-between px-1">
        <Text className="text-xs font-medium tracking-wide text-muted uppercase">
          {filtered.length} {filtered.length === 1 ? "product" : "products"}
        </Text>
        {refreshing ? <Spinner size="sm" /> : null}
      </View>
    </View>
  );

  const empty = loading ? (
    <View className="items-center gap-3 py-16">
      <Spinner />
      <Text className="text-sm text-muted">Syncing products…</Text>
    </View>
  ) : (
    <View className="bg-surface-secondary items-center gap-2 rounded-3xl px-8 py-12">
      <MaterialIcons color={muted} name={query ? "search-off" : "inventory-2"} size={30} />
      <Text className="text-sm font-medium text-foreground">
        {query || filter !== "all" ? "No matching products" : "No products yet"}
      </Text>
      <Text className="text-center text-xs leading-5 text-muted">
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
          }}
        >
          Clear filters
        </Button>
      ) : null}
    </View>
  );

  return (
    <FlashList
      className="bg-background"
      contentContainerStyle={listContentStyle}
      contentInsetAdjustmentBehavior="automatic"
      data={filtered}
      keyExtractor={keyExtractor}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={empty}
      ListHeaderComponent={header}
      onRefresh={refresh}
      refreshing={refreshing}
      renderItem={renderItem}
    />
  );
}
