import { useUser } from "@clerk/expo";
import { router } from "expo-router";
import { useThemeColor } from "heroui-native";
import { Alert as HeroAlert } from "heroui-native/alert";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { Separator } from "heroui-native/separator";
import { Spinner } from "heroui-native/spinner";
import { RefreshControl, ScrollView, Text, View } from "react-native";

import { Brand } from "@/components/brand";
import { ProductAnalytics } from "@/components/product-analytics";
import { useProducts } from "@/features/products/products-provider";

const LOW_STOCK_THRESHOLD = 10;

const greetingFor = (hour: number) => {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

export default function HomeScreen() {
  const { user } = useUser();
  const { products, loading, refreshing, error, refresh } = useProducts();
  const [accent, background] = useThemeColor(["accent", "background"]);
  const firstName = user?.firstName?.trim() || user?.fullName?.trim().split(/\s+/)[0];
  const attention = products
    .filter((product) => product.stock <= LOW_STOCK_THRESHOLD)
    .sort((left, right) => left.stock - right.stock)
    .slice(0, 4);

  return (
    <ScrollView
      className="bg-background"
      contentContainerClassName="gap-6 px-4 pb-10 pt-3"
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        <RefreshControl
          colors={[accent]}
          onRefresh={() => void refresh()}
          progressBackgroundColor={background}
          refreshing={refreshing}
          tintColor={accent}
        />
      }
    >
      <View className="gap-4">
        <Brand />
        <View className="gap-1">
          <Text className="text-2xl leading-8 font-medium text-foreground">
            {greetingFor(new Date().getHours())}
            {firstName ? `, ${firstName}` : ""}
          </Text>
          <Text className="text-sm leading-5 font-normal text-muted">
            Here’s what needs your attention today.
          </Text>
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
          <Card.Body className="min-h-36 items-center justify-center gap-3">
            <Spinner color="default" />
            <Text className="text-sm font-normal text-muted">Syncing your inventory…</Text>
          </Card.Body>
        </Card>
      ) : (
        <ProductAnalytics products={products} />
      )}

      <View className="gap-3">
        <View className="flex-row items-end justify-between gap-4">
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-base font-medium text-foreground">Needs attention</Text>
            <Text className="text-xs font-normal text-muted">
              Products at or below {LOW_STOCK_THRESHOLD} units
            </Text>
          </View>
          <Button size="sm" variant="ghost" onPress={() => router.push("/products")}>
            View all
          </Button>
        </View>

        <Card variant="default">
          <Card.Body className="p-0">
            {attention.length > 0 ? (
              attention.map((product, index) => (
                <View key={product.id}>
                  {index > 0 ? <Separator /> : null}
                  <View className="flex-row items-center gap-3 px-4 py-3.5">
                    <View
                      className={`size-2 rounded-full ${product.stock === 0 ? "bg-danger" : "bg-warning"}`}
                    />
                    <View className="min-w-0 flex-1 gap-0.5">
                      <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                        {product.name}
                      </Text>
                      <Text className="text-xs font-normal text-muted" numberOfLines={1}>
                        {product.category}
                      </Text>
                    </View>
                    <Text
                      className={`font-mono text-sm ${product.stock === 0 ? "text-danger" : "text-warning"}`}
                    >
                      {product.stock === 0 ? "Out" : product.stock}
                    </Text>
                  </View>
                </View>
              ))
            ) : (
              <View className="items-center gap-2 px-6 py-8">
                <Text className="text-sm font-medium text-foreground">
                  {products.length === 0 ? "No products yet" : "Inventory looks healthy"}
                </Text>
                <Text className="text-center text-xs leading-5 font-normal text-muted">
                  {products.length === 0
                    ? "Add products from the desktop app and pull down to sync them here."
                    : "Nothing is currently low or out of stock."}
                </Text>
              </View>
            )}
          </Card.Body>
        </Card>
      </View>

      <Button className="w-full" onPress={() => router.push("/products")}>
        Browse inventory
      </Button>
    </ScrollView>
  );
}
