import { useCatalogIsReady } from "@store/inventory-react";
import { Stack, useLocalSearchParams } from "expo-router";
import { StyleSheet, View } from "react-native";

import { detailHeaderOptions } from "@/features/detail-header";
import { ListSkeleton } from "@/features/list-states";
import { InvoiceDetail } from "@/features/sales/invoice-detail";
import { colors } from "@/theme/tokens";

export default function InvoiceScreen() {
  const { invoiceId } = useLocalSearchParams<{ invoiceId: string }>();
  const ready = useCatalogIsReady();
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ ...detailHeaderOptions, title: "Invoice" }} />
      {ready ? <InvoiceDetail invoiceId={invoiceId} /> : <ListSkeleton label="Opening invoice" />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ground,
  },
});
