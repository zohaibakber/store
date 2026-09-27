import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import type { Invoice } from "@store/contracts";
import { useInventoryInvoices } from "@store/inventory-react";
import { useRouter } from "expo-router";
import * as React from "react";
import { StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

import { colors, space } from "@/theme/tokens";
import { Text } from "@/ui/text";

import { formatPrice } from "../format";
import { EmptyState, ListSkeleton, RowSeparator } from "../list-states";
import { SCAN_FAB_CLEARANCE } from "../scan-fab";
import { InvoiceRow } from "./invoice-row";
import { invoiceSubtitle, invoiceTitle } from "./invoice-text";

const INVOICE_LIST_LIMIT = 200;

const keyOf = (invoice: Invoice) => invoice.id;

export function InvoiceList({
  refreshing,
  onRefresh,
  onScroll,
}: {
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  readonly onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}) {
  const { push } = useRouter();
  const invoices = useInventoryInvoices(INVOICE_LIST_LIMIT);

  const openInvoice = React.useCallback(
    (invoiceId: string) => push({ pathname: "/sales/[invoiceId]", params: { invoiceId } }),
    [push],
  );

  const renderItem = ({ item }: ListRenderItemInfo<Invoice>) => (
    <InvoiceRow
      id={item.id}
      title={invoiceTitle(item.invoiceNumber)}
      subtitle={invoiceSubtitle(item)}
      total={formatPrice(item.total)}
      onOpen={openInvoice}
    />
  );

  const empty = invoices.isLoading ? (
    <ListSkeleton label="Loading sales" />
  ) : (
    <EmptyState
      title="No sales yet"
      body="Invoices issued on the desktop app show up here after they sync."
    />
  );
  const footer =
    invoices.data.length >= INVOICE_LIST_LIMIT ? (
      <Text size="xs" tone="muted" style={styles.footer}>
        Showing the latest {INVOICE_LIST_LIMIT} invoices.
      </Text>
    ) : null;

  return (
    <View style={styles.list}>
      <FlashList
        contentContainerStyle={styles.content}
        data={invoices.data}
        ItemSeparatorComponent={RowSeparator}
        keyExtractor={keyOf}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        onRefresh={onRefresh}
        onScroll={onScroll}
        refreshing={refreshing}
        renderItem={renderItem}
        scrollEventThrottle={16}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: colors.ground,
  },
  content: {
    paddingBottom: SCAN_FAB_CLEARANCE + space[4],
  },
  footer: {
    paddingHorizontal: space[4],
    paddingVertical: space[4],
    textAlign: "center",
  },
});
