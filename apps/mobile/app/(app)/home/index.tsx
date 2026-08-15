import { useUser } from "@clerk/expo";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { RefreshControl, ScrollView, Text, View } from "react-native";

import { Brand } from "@/components/brand";
import {
  Alert as HeroAlert,
  Button,
  Card,
  Separator,
  Spinner,
  useThemeColor,
} from "@/components/mobile-ui";
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
  const [accent, background, warning, danger] = useThemeColor([
    "accent",
    "background",
    "warning",
    "danger",
  ]);
  const firstName = user?.firstName?.trim() || user?.fullName?.trim().split(/\s+/)[0];
  const attention = products
    .filter((product) => product.stock <= LOW_STOCK_THRESHOLD)
    .sort((left, right) => left.stock - right.stock)
    .slice(0, 4);

  return (
    <ScrollView
      className="bg-background"
      contentContainerClassName="gap-6 px-4 pb-32 pt-3"
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
      <Brand />

      <View className="relative overflow-hidden rounded-[28px] bg-accent px-5 py-5">
        <View className="bg-blue/25 absolute -top-12 -right-8 size-32 rounded-full" />
        <View className="bg-purple/20 absolute -bottom-16 -left-8 size-32 rounded-full" />
        <View className="relative gap-4">
          <View className="size-11 items-center justify-center rounded-2xl bg-accent-foreground/15">
            <MaterialIcons color="#ffffff" name="insights" size={24} />
          </View>
          <View className="gap-1">
            <Text className="text-2xl leading-8 font-medium text-accent-foreground">
              {greetingFor(new Date().getHours())}
              {firstName ? `, ${firstName}` : ""}
            </Text>
            <Text className="text-sm leading-5 text-accent-foreground/75">
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
        <Card variant="accent">
          <Card.Body className="min-h-36 items-center justify-center gap-3">
            <Spinner color="default" />
            <Text className="text-accent-soft-foreground text-sm">Syncing your inventory…</Text>
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
                      className={`size-10 items-center justify-center rounded-2xl ${product.stock === 0 ? "bg-danger-soft" : "bg-warning-soft"}`}
                    >
                      <MaterialIcons
                        color={product.stock === 0 ? danger : warning}
                        name={product.stock === 0 ? "error-outline" : "inventory-2"}
                        size={19}
                      />
                    </View>
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
                    ? "Tap the add button to create a product with a form or scan its label."
                    : "Nothing is currently low or out of stock."}
                </Text>
              </View>
            )}
          </Card.Body>
        </Card>
      </View>

      <Button className="w-full" variant="secondary" onPress={() => router.push("/products")}>
        Browse inventory
      </Button>
    </ScrollView>
  );
}
