import { router } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";

import { InventoryFabAnchor } from "@/components/inventory-fab-anchor";
import { ProductAnalytics } from "@/components/product-analytics";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, ButtonIcon, ButtonText } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Row, RowChevron, RowGroup, RowValue } from "@/components/ui/row";
import { Spinner } from "@/components/ui/spinner";
import { SectionTitle, Text } from "@/components/ui/text";
import {
  productStatusView,
  useProductActions,
  useProductData,
  useProductStatus,
} from "@/features/products/products-provider";
import { useScrollInset } from "@/hooks/use-overlay-insets";
import { LOW_STOCK_THRESHOLD, needsAttention } from "@/lib/product-catalog";
import { useColors } from "@/theme/colors";

/**
 * The overview. Two groups — what the inventory adds up to, and what needs
 * restocking — and nothing that repeats a number the other group already shows.
 */
export function HomeScreen() {
  const { products } = useProductData();
  const { loading, refreshing, error } = productStatusView(useProductStatus());
  const { refresh } = useProductActions();
  const colors = useColors();
  const scrollBottom = useScrollInset("nav-and-actions");
  const attention = needsAttention(products);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: scrollBottom }]}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl
            colors={[colors.foreground]}
            onRefresh={() => void refresh()}
            progressBackgroundColor={colors.card}
            refreshing={refreshing}
            tintColor={colors.mutedForeground}
          />
        }
      >
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Inventory is out of date</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
            <AlertAction>
              <Button onPress={() => void refresh()} size="sm" variant="outline">
                <ButtonIcon name="refresh" />
                <ButtonText>Retry</ButtonText>
              </Button>
            </AlertAction>
          </Alert>
        ) : null}

        {loading ? (
          <View style={styles.loading}>
            <Spinner tone="muted" />
            <Text tone="muted" variant="caption">
              Syncing your inventory…
            </Text>
          </View>
        ) : (
          <ProductAnalytics products={products} />
        )}

        <View style={styles.section}>
          <SectionTitle>Needs attention</SectionTitle>
          <RowGroup>
            {attention.map((product) => (
              <Row
                key={product.id}
                leading={
                  <Icon
                    name={product.stock === 0 ? "alert" : "box"}
                    size={18}
                    tone={product.stock === 0 ? "destructive" : "warning"}
                  />
                }
                supporting={product.category}
                title={product.name}
                trailing={
                  <RowValue tone={product.stock === 0 ? "destructive" : "warning"}>
                    {product.stock === 0 ? "Out" : String(product.stock)}
                  </RowValue>
                }
              />
            ))}
            {attention.length === 0 ? (
              <Row
                supporting={
                  products.length === 0
                    ? "Create one, or scan a label."
                    : `Nothing is at or below ${LOW_STOCK_THRESHOLD} units.`
                }
                title={products.length === 0 ? "No products yet" : "Stock looks healthy"}
              />
            ) : null}
            <Row
              onPress={() => router.push("/products")}
              title="All products"
              trailing={
                <>
                  <RowValue>{String(products.length)}</RowValue>
                  <RowChevron />
                </>
              }
            />
          </RowGroup>
        </View>
      </ScrollView>
      <InventoryFabAnchor />
    </View>
  );
}

export default HomeScreen;

const styles = StyleSheet.create({
  content: { gap: 24, paddingHorizontal: 16, paddingTop: 8 },
  loading: { alignItems: "center", gap: 12, justifyContent: "center", minHeight: 144 },
  root: { flex: 1 },
  section: { gap: 8 },
});
