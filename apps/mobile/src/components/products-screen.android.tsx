import { Host } from "@expo/ui";
import {
  Box,
  DockedSearchBar,
  FilterChip,
  FlowRow,
  Icon,
  LazyColumn,
  LoadingIndicator,
  PullToRefreshBox,
  Surface,
  Text,
  useMaterialColors,
} from "@expo/ui/jetpack-compose";
import { fillMaxSize, fillMaxWidth, padding } from "@expo/ui/jetpack-compose/modifiers";
import { useDeferredValue, useMemo, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import inventoryIcon from "@/assets/icons/inventory.xml";
import searchIcon from "@/assets/icons/search.xml";
import warningIcon from "@/assets/icons/warning.xml";
import {
  ErrorBanner,
  FilledListCard,
  InventoryFabButtons,
  MaterialListItem,
  TintedIcon,
} from "@/components/material-list.android";
import {
  useProductActions,
  useProductData,
  useProductStatus,
} from "@/features/products/products-provider";
import {
  filterCatalog,
  productSupportingText,
  STOCK_FILTERS,
  type StockFilter,
} from "@/lib/product-catalog";
import { formatPrice } from "@/lib/products";
import { useAppColorScheme } from "@/theme/appearance";

export function ProductsScreen() {
  const colorScheme = useAppColorScheme();
  const colors = useMaterialColors({ colorScheme });
  const insets = useSafeAreaInsets();
  const { products } = useProductData();
  const { loading, refreshing, error } = useProductStatus();
  const { refresh } = useProductActions();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StockFilter>("all");
  const deferredQuery = useDeferredValue(query);
  const filtered = useMemo(
    () => filterCatalog(products, deferredQuery, filter),
    [deferredQuery, filter, products],
  );

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
              <DockedSearchBar modifiers={[fillMaxWidth()]} onQueryChange={setQuery}>
                <DockedSearchBar.Placeholder>
                  <Text>Name, category, aisle or batch</Text>
                </DockedSearchBar.Placeholder>
                <DockedSearchBar.LeadingIcon>
                  <Icon source={searchIcon} />
                </DockedSearchBar.LeadingIcon>
              </DockedSearchBar>

              <FlowRow horizontalArrangement={{ spacedBy: 8 }} modifiers={[fillMaxWidth()]}>
                {STOCK_FILTERS.map((option) => (
                  <FilterChip
                    key={option.value}
                    onClick={() => setFilter(option.value)}
                    selected={filter === option.value}
                  >
                    <FilterChip.Label>
                      <Text>{option.label}</Text>
                    </FilterChip.Label>
                  </FilterChip>
                ))}
              </FlowRow>

              {error ? (
                <ErrorBanner
                  message={error}
                  onRetry={() => void refresh()}
                  title="Inventory may be out of date"
                />
              ) : null}

              <Text color={colors.onSurfaceVariant} style={{ typography: "bodySmall" }}>
                {`${filtered.length} ${filtered.length === 1 ? "product" : "products"}`}
              </Text>

              {loading ? (
                <FilledListCard>
                  <Box
                    contentAlignment="center"
                    modifiers={[fillMaxWidth(), padding(16, 32, 16, 32)]}
                  >
                    <LoadingIndicator />
                  </Box>
                </FilledListCard>
              ) : null}

              {!loading && filtered.length === 0 ? (
                <MaterialListItem
                  headline={query || filter !== "all" ? "No matching products" : "No products yet"}
                  supporting={
                    query || filter !== "all"
                      ? "Try a broader search or another stock filter."
                      : "Use the + button to create a product or the camera to scan a label."
                  }
                />
              ) : null}

              {filtered.map((product) => (
                <MaterialListItem
                  key={product.id}
                  headline={product.name}
                  leading={
                    <TintedIcon
                      container={
                        product.stock === 0
                          ? colors.errorContainer
                          : product.stock <= 10
                            ? colors.tertiaryContainer
                            : colors.secondaryContainer
                      }
                      source={product.stock === 0 ? warningIcon : inventoryIcon}
                      tint={
                        product.stock === 0
                          ? colors.onErrorContainer
                          : product.stock <= 10
                            ? colors.onTertiaryContainer
                            : colors.onSecondaryContainer
                      }
                    />
                  }
                  overline={product.visible ? undefined : "Hidden"}
                  supporting={productSupportingText(product) || undefined}
                  trailing={`${formatPrice(product.unitPrice)} · ${product.stockLabel}`}
                  trailingColor={
                    product.stock === 0
                      ? colors.error
                      : product.stock <= 10
                        ? colors.tertiary
                        : colors.onSurfaceVariant
                  }
                />
              ))}
            </LazyColumn>
          </PullToRefreshBox>
          <InventoryFabButtons />
        </Box>
      </Surface>
    </Host>
  );
}

export default ProductsScreen;
