import { Host } from "@expo/ui";
import {
  Box,
  Column,
  LazyColumn,
  LoadingIndicator,
  PullToRefreshBox,
  Surface,
  useMaterialColors,
} from "@expo/ui/jetpack-compose";
import { fillMaxSize, fillMaxWidth, padding } from "@expo/ui/jetpack-compose/modifiers";
import { router } from "expo-router";
import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import inventoryIcon from "@/assets/icons/inventory.xml";
import warningIcon from "@/assets/icons/warning.xml";
import {
  ErrorBanner,
  FilledListCard,
  InventoryFabButtons,
  ListSection,
  MaterialListItem,
  TintedIcon,
} from "@/components/material-list.android";
import {
  productStatusView,
  useProductActions,
  useProductData,
  useProductStatus,
} from "@/features/products/products-provider";
import { inventoryOverview, LOW_STOCK_THRESHOLD, needsAttention } from "@/lib/product-catalog";
import { formatPrice } from "@/lib/products";
import { useAppColorScheme } from "@/theme/appearance";

export function HomeScreen() {
  const colorScheme = useAppColorScheme();
  const colors = useMaterialColors({ colorScheme });
  const insets = useSafeAreaInsets();
  const { products } = useProductData();
  const { loading, refreshing, error } = productStatusView(useProductStatus());
  const { refresh } = useProductActions();
  const [showValue, setShowValue] = useState(false);
  const attention = needsAttention(products);
  const overview = inventoryOverview(products);

  return (
    <Host colorScheme={colorScheme} key={colorScheme} style={{ flex: 1 }}>
      <Surface color={colors.surfaceContainer} modifiers={[fillMaxSize()]}>
        <Box modifiers={[fillMaxSize()]}>
          <PullToRefreshBox
            contentAlignment="topCenter"
            isRefreshing={refreshing}
            modifiers={[fillMaxSize()]}
            onRefresh={() => void refresh()}
          >
            <LazyColumn
              contentPadding={{ bottom: 160, end: 16, start: 16, top: insets.top + 8 }}
              modifiers={[fillMaxSize()]}
              verticalArrangement={{ spacedBy: 8 }}
            >
              <MaterialListItem
                headline={__DEV__ ? "Tabaaq Dev" : "Tabaaq"}
                leading={
                  <TintedIcon
                    container={colors.primaryContainer}
                    source={inventoryIcon}
                    tint={colors.onPrimaryContainer}
                  />
                }
                supporting="Inventory, in sync"
              />

              {error ? (
                <ErrorBanner
                  message={error}
                  onRetry={() => void refresh()}
                  title="Inventory is out of date"
                />
              ) : null}

              {loading ? (
                <FilledListCard>
                  <Box
                    contentAlignment="center"
                    modifiers={[fillMaxWidth(), padding(16, 32, 16, 32)]}
                  >
                    <LoadingIndicator />
                  </Box>
                </FilledListCard>
              ) : (
                <Column modifiers={[fillMaxWidth()]} verticalArrangement={{ spacedBy: 8 }}>
                  <MaterialListItem
                    headline="Products"
                    leading={
                      <TintedIcon
                        container={colors.primaryContainer}
                        source={inventoryIcon}
                        tint={colors.onPrimaryContainer}
                      />
                    }
                    supporting="In the catalog"
                    trailing={String(overview.count)}
                  />
                  <MaterialListItem
                    headline="Low stock"
                    leading={
                      <TintedIcon
                        container={colors.tertiaryContainer}
                        source={warningIcon}
                        tint={colors.onTertiaryContainer}
                      />
                    }
                    supporting={`At or below ${LOW_STOCK_THRESHOLD} units`}
                    trailing={String(overview.lowStock)}
                    trailingColor={colors.tertiary}
                  />
                  <MaterialListItem
                    headline="Out of stock"
                    leading={
                      <TintedIcon
                        container={colors.errorContainer}
                        source={warningIcon}
                        tint={colors.onErrorContainer}
                      />
                    }
                    supporting="Needs restock"
                    trailing={String(overview.outOfStock)}
                    trailingColor={colors.error}
                  />
                  <MaterialListItem
                    headline="Stock value"
                    onClick={() => setShowValue((current) => !current)}
                    supporting={showValue ? "Tap to hide" : "Tap to reveal"}
                    trailing={showValue ? formatPrice(overview.stockValue) : "••••••"}
                  />
                </Column>
              )}

              <ListSection
                headline="Needs attention"
                supporting={`Products at or below ${LOW_STOCK_THRESHOLD} units`}
              >
                {attention.length > 0 ? (
                  attention.map((product) => (
                    <MaterialListItem
                      key={product.id}
                      headline={product.name}
                      leading={
                        <TintedIcon
                          container={
                            product.stock === 0 ? colors.errorContainer : colors.tertiaryContainer
                          }
                          source={product.stock === 0 ? warningIcon : inventoryIcon}
                          tint={
                            product.stock === 0
                              ? colors.onErrorContainer
                              : colors.onTertiaryContainer
                          }
                        />
                      }
                      onClick={() => router.push("/products")}
                      supporting={product.category}
                      trailing={product.stock === 0 ? "Out" : String(product.stock)}
                      trailingColor={product.stock === 0 ? colors.error : colors.tertiary}
                    />
                  ))
                ) : (
                  <MaterialListItem
                    headline={products.length === 0 ? "No products yet" : "Inventory looks healthy"}
                    supporting={
                      products.length === 0
                        ? "Use the + button to create a product or scan its label."
                        : "Nothing is currently low or out of stock."
                    }
                  />
                )}
                <MaterialListItem
                  headline="View all products"
                  onClick={() => router.push("/products")}
                  supporting="Open the full catalog"
                />
              </ListSection>
            </LazyColumn>
          </PullToRefreshBox>
          <InventoryFabButtons />
        </Box>
      </Surface>
    </Host>
  );
}

export default HomeScreen;
