import { useCatalogIsReady } from "@store/inventory-react";
import { Stack, useLocalSearchParams } from "expo-router";
import { StyleSheet, View } from "react-native";

import { detailHeaderOptions } from "@/features/detail-header";
import { ListSkeleton } from "@/features/list-states";
import { ProductDetail } from "@/features/stock/product-detail";
import { colors } from "@/theme/tokens";

export default function ProductScreen() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const ready = useCatalogIsReady();
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ ...detailHeaderOptions, title: "" }} />
      {ready ? <ProductDetail productId={productId} /> : <ListSkeleton label="Opening product" />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ground,
  },
});
