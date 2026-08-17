import { useUser } from "@clerk/expo";
import { router } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { Brand } from "@/components/brand";
import { ProductAnalytics } from "@/components/product-analytics";
import { IconSymbol } from "@/components/symbol";
import { Alert as HeroAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  useProductActions,
  useProductData,
  useProductStatus,
} from "@/features/products/products-provider";
import { useThemeColor } from "@/hooks/use-theme-color";

const LOW_STOCK_THRESHOLD = 10;

const greetingFor = (hour: number) => {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

export default function HomeScreen() {
  const { user } = useUser();
  const { products } = useProductData();
  const { loading, refreshing, error } = useProductStatus();
  const { refresh } = useProductActions();
  const [foreground, background, warning, danger, muted, subtle] = useThemeColor([
    "foreground",
    "background",
    "warning",
    "danger",
    "muted",
    "surface-tertiary",
  ]);
  const firstName = user?.firstName?.trim() || user?.fullName?.trim().split(/\s+/)[0];
  const attention = products
    .filter((product) => product.stock <= LOW_STOCK_THRESHOLD)
    .sort((left, right) => left.stock - right.stock)
    .slice(0, 4);

  return (
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
      <Brand />

      <View style={[styles.hero, { backgroundColor: subtle }]}>
        <View style={styles.heroContent}>
          <View style={[styles.heroIcon, { backgroundColor: background }]}>
            <IconSymbol name="chart.line.uptrend.xyaxis" size={22} tintColor={foreground} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={[styles.heroTitle, { color: foreground }]}>
              {greetingFor(new Date().getHours())}
              {firstName ? `, ${firstName}` : ""}
            </Text>
            <Text style={[styles.heroSubtitle, { color: muted }]}>
              Your inventory overview is ready.
            </Text>
          </View>
        </View>
      </View>

      {error ? (
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
      ) : null}

      {loading ? (
        <Card variant="secondary">
          <Card.Body style={styles.loadingCard}>
            <Spinner color="default" />
            <Text style={[styles.bodyText, { color: muted }]}>Syncing your inventory…</Text>
          </Card.Body>
        </Card>
      ) : (
        <ProductAnalytics products={products} />
      )}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionCopy}>
            <Text style={[styles.sectionTitle, { color: foreground }]}>Needs attention</Text>
            <Text style={[styles.caption, { color: muted }]}>
              Products at or below {LOW_STOCK_THRESHOLD} units
            </Text>
          </View>
          <Button size="sm" variant="ghost" onPress={() => router.push("/products")}>
            View all
          </Button>
        </View>

        <Card variant="default">
          <Card.Body style={styles.cardFlush}>
            {attention.length > 0 ? (
              attention.map((product, index) => (
                <View key={product.id}>
                  {index > 0 ? <Separator /> : null}
                  <View style={styles.attentionRow}>
                    <View style={[styles.attentionIcon, { backgroundColor: subtle }]}>
                      <IconSymbol
                        name={product.stock === 0 ? "exclamationmark.triangle" : "shippingbox"}
                        size={19}
                        tintColor={product.stock === 0 ? danger : warning}
                      />
                    </View>
                    <View style={styles.attentionCopy}>
                      <Text style={[styles.bodyMedium, { color: foreground }]} numberOfLines={1}>
                        {product.name}
                      </Text>
                      <Text style={[styles.caption, { color: muted }]} numberOfLines={1}>
                        {product.category}
                      </Text>
                    </View>
                    <Text
                      selectable
                      style={[styles.stock, { color: product.stock === 0 ? danger : warning }]}
                    >
                      {product.stock === 0 ? "Out" : product.stock}
                    </Text>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.empty}>
                <Text style={[styles.bodyMedium, { color: foreground }]}>
                  {products.length === 0 ? "No products yet" : "Inventory looks healthy"}
                </Text>
                <Text style={[styles.emptyText, { color: muted }]}>
                  {products.length === 0
                    ? "Tap the add button to create a product with a form or scan its label."
                    : "Nothing is currently low or out of stock."}
                </Text>
              </View>
            )}
          </Card.Body>
        </Card>
      </View>

      <Button variant="secondary" onPress={() => router.push("/products")}>
        Browse inventory
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  attentionCopy: { flex: 1, gap: 2, minWidth: 0 },
  attentionIcon: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 10,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  attentionRow: { alignItems: "center", flexDirection: "row", gap: 12, padding: 14 },
  bodyMedium: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20 },
  bodyText: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  cardFlush: { padding: 0 },
  content: { gap: 24, paddingBottom: 112, paddingHorizontal: 16, paddingTop: 12 },
  empty: { alignItems: "center", gap: 8, paddingHorizontal: 24, paddingVertical: 28 },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 20,
    textAlign: "center",
  },
  hero: {
    borderCurve: "continuous",
    borderRadius: 16,
    overflow: "hidden",
    padding: 20,
  },
  heroContent: { gap: 16 },
  heroCopy: { gap: 4 },
  heroIcon: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 10,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  heroSubtitle: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
  heroTitle: { fontFamily: "Inter_500Medium", fontSize: 24, lineHeight: 32 },
  loadingCard: { alignItems: "center", gap: 12, justifyContent: "center", minHeight: 144 },
  section: { gap: 12 },
  sectionCopy: { flex: 1, gap: 4, minWidth: 0 },
  sectionHeader: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 16,
    justifyContent: "space-between",
  },
  sectionTitle: { fontFamily: "Inter_500Medium", fontSize: 16, lineHeight: 22 },
  stock: {
    fontFamily: "GeistMono_400Regular",
    fontSize: 14,
    fontVariant: ["tabular-nums"],
    lineHeight: 20,
  },
});
