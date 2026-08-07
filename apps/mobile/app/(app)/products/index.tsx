import { FlashList, type ListRenderItem } from "@shopify/flash-list";
import { Stack } from "expo-router";
import { Alert as HeroAlert } from "heroui-native/alert";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { Spinner } from "heroui-native/spinner";
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";

import { ProductAnalytics } from "@/components/product-analytics";
import { ProductRow } from "@/components/product-row";
import { useProducts } from "@/features/products/products-provider";
import type { MobileProduct } from "@/lib/products";

const keyExtractor = (item: MobileProduct) => item.id;
const listContentStyle = { paddingBottom: 32, paddingHorizontal: 16 } as const;

export default function ProductsScreen() {
  const { products, loading, refreshing, error, refresh } = useProducts();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return products;
    return products.filter((product) =>
      [product.name, product.category, product.details, product.aisle]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(term)),
    );
  }, [products, query]);

  const renderItem = useCallback<ListRenderItem<MobileProduct>>(
    ({ item }) => (
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
    ),
    [],
  );

  const header = useMemo(
    () => (
      <View className="gap-5 pt-3 pb-3">
        <View className="gap-1">
          <Text className="text-base font-medium text-foreground">Inventory overview</Text>
          <Text className="text-xs leading-5 font-normal text-muted">
            Search products, check stock, and pull down for the latest desktop changes.
          </Text>
        </View>
        <ProductAnalytics products={products} />
        {error ? (
          <HeroAlert status="danger">
            <HeroAlert.Indicator />
            <HeroAlert.Content>
              <HeroAlert.Title>Could not load products</HeroAlert.Title>
              <HeroAlert.Description>{error}</HeroAlert.Description>
            </HeroAlert.Content>
            <Button size="sm" variant="danger-soft" onPress={() => void refresh()}>
              Try again
            </Button>
          </HeroAlert>
        ) : null}
        <Text className="text-xs font-medium tracking-wide text-muted uppercase">
          {query ? `${filtered.length} matching products` : `${filtered.length} products`}
        </Text>
      </View>
    ),
    [error, filtered.length, products, query, refresh],
  );

  const empty = loading ? (
    <View className="items-center gap-3 py-14">
      <Spinner color="default" />
      <Text className="text-sm font-normal text-muted">Syncing products…</Text>
    </View>
  ) : (
    <Card variant="secondary">
      <Card.Body className="items-center gap-2 px-6 py-8">
        <Text className="text-sm font-medium text-foreground">
          {query ? "No matches" : "No products yet"}
        </Text>
        <Text className="text-center text-xs leading-5 font-normal text-muted">
          {query
            ? "Try a product name, category, composition, or aisle."
            : "Add products from the desktop app, then pull down to sync."}
        </Text>
        {!query ? (
          <Button size="sm" variant="secondary" onPress={() => void refresh()}>
            Refresh inventory
          </Button>
        ) : null}
      </Card.Body>
    </Card>
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            hideWhenScrolling: false,
            onCancelButtonPress: () => setQuery(""),
            onChangeText: (event) => setQuery(event.nativeEvent.text),
            placeholder: "Search inventory",
          },
        }}
      />
      <FlashList
        className="bg-background"
        contentContainerStyle={listContentStyle}
        contentInsetAdjustmentBehavior="automatic"
        data={filtered}
        keyExtractor={keyExtractor}
        keyboardDismissMode="on-drag"
        ListEmptyComponent={empty}
        ListHeaderComponent={header}
        onRefresh={refresh}
        refreshing={refreshing}
        renderItem={renderItem}
      />
    </>
  );
}
