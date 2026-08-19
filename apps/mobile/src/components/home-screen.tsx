import { Icon, ListItem, Text as UiText } from "@expo/ui";
import { router } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppList } from "@/components/app-list";
import { Brand } from "@/components/brand";
import { InventoryFabAnchor } from "@/components/inventory-fab-anchor";
import { inventoryIconName, warningIcon } from "@/components/list-icons";
import { ProductAnalytics } from "@/components/product-analytics";
import { Alert as HeroAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  useProductActions,
  useProductData,
  useProductStatus,
  productStatusView,
} from "@/features/products/products-provider";
import { useThemeColor } from "@/hooks/use-theme-color";
import { LOW_STOCK_THRESHOLD, needsAttention } from "@/lib/product-catalog";
import { cssColor } from "@/theme/colors";

export function HomeScreen() {
  const { products } = useProductData();
  const { loading, refreshing, error } = productStatusView(useProductStatus());
  const { refresh } = useProductActions();
  const [foreground, background, warning, danger, muted] = useThemeColor([
    "foreground",
    "background",
    "warning",
    "danger",
    "muted",
  ]);
  const attention = needsAttention(products);

  return (
    <View style={[styles.root, { backgroundColor: background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl
            colors={[foreground]}
            onRefresh={() => void refresh()}
            progressBackgroundColor={background}
            refreshing={refreshing}
            tintColor={foreground}
          />
        }
        style={{ backgroundColor: background }}
      >
        <View style={styles.padded}>
          <Brand />
        </View>

        {error ? (
          <View style={styles.padded}>
            <HeroAlert status="danger">
              <HeroAlert.Indicator />
              <HeroAlert.Content>
                <HeroAlert.Title>Inventory is out of date</HeroAlert.Title>
                <HeroAlert.Description>{error}</HeroAlert.Description>
              </HeroAlert.Content>
              <Button size="sm" variant="danger-soft" onPress={() => void refresh()}>
                Retry
              </Button>
            </HeroAlert>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loading}>
            <Spinner color="default" />
            <Text style={[styles.bodyText, { color: muted }]}>Syncing your inventory…</Text>
          </View>
        ) : (
          <ProductAnalytics products={products} />
        )}

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: foreground }]}>Needs attention</Text>
          <Text style={[styles.caption, { color: muted }]}>
            Products at or below {LOW_STOCK_THRESHOLD} units
          </Text>
        </View>

        <AppList>
          {attention.length > 0 ? (
            attention.map((product) => (
              <ListItem
                key={product.id}
                leading={
                  <Icon
                    color={product.stock === 0 ? danger : warning}
                    name={product.stock === 0 ? warningIcon : inventoryIconName}
                    size={24}
                  />
                }
                onPress={() => router.push("/products")}
                supportingText={product.category}
                trailing={
                  <UiText
                    textStyle={{
                      color: cssColor(product.stock === 0 ? danger : warning),
                    }}
                  >
                    {product.stock === 0 ? "Out" : String(product.stock)}
                  </UiText>
                }
              >
                {product.name}
              </ListItem>
            ))
          ) : (
            <ListItem
              supportingText={
                products.length === 0
                  ? "Use the + button to create a product or scan its label."
                  : "Nothing is currently low or out of stock."
              }
            >
              {products.length === 0 ? "No products yet" : "Inventory looks healthy"}
            </ListItem>
          )}
          <ListItem onPress={() => router.push("/products")} supportingText="Open the full catalog">
            View all products
          </ListItem>
        </AppList>
      </ScrollView>
      <InventoryFabAnchor />
    </View>
  );
}

export default HomeScreen;

const styles = StyleSheet.create({
  bodyText: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  content: { gap: 8, paddingBottom: 160, paddingTop: 12 },
  loading: { alignItems: "center", gap: 12, justifyContent: "center", minHeight: 144 },
  padded: { paddingHorizontal: 16 },
  root: { flex: 1 },
  sectionHeader: { gap: 4, paddingHorizontal: 16, paddingTop: 16 },
  sectionTitle: { fontFamily: "Inter_500Medium", fontSize: 16, lineHeight: 22 },
});
