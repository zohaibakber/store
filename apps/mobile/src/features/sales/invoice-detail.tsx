import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import type { Invoice, InvoiceItem } from "@store/contracts";
import { useInventoryInvoice } from "@store/inventory-react";
import { Stack } from "expo-router";
import * as React from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, space } from "@/theme/tokens";
import { Text } from "@/ui/text";

import { detailHeaderOptions } from "../detail-header";
import { formatDateTime, formatPrice } from "../format";
import { EmptyState, ListSkeleton, RowSeparator } from "../list-states";
import { invoiceItemQuantity, invoiceTitle, itemCountLabel } from "./invoice-text";

const keyOf = (item: InvoiceItem) => item.id;

export function InvoiceDetail({ invoiceId }: { readonly invoiceId: string }) {
  const invoice = useInventoryInvoice(invoiceId);
  if (invoice.data === undefined) {
    return invoice.isLoading ? (
      <ListSkeleton label="Loading invoice" />
    ) : (
      <EmptyState title="Invoice not found" body="It may not have synced to this phone yet." />
    );
  }
  return <InvoiceDetailBody invoice={invoice.data} />;
}

function InvoiceDetailBody({ invoice }: { readonly invoice: Invoice }) {
  const insets = useSafeAreaInsets();
  const renderItem = ({ item }: ListRenderItemInfo<InvoiceItem>) => (
    <InvoiceLine
      name={item.productName}
      detail={[
        `${invoiceItemQuantity(item)} × ${formatPrice(item.salePrice)}`,
        item.batchNumber ? `Batch ${item.batchNumber}` : null,
      ]
        .filter((part): part is string => part !== null)
        .join(" · ")}
      total={formatPrice(item.salePrice * item.quantity)}
    />
  );
  const summary = (
    <View style={styles.summary}>
      <Text tone="muted">{formatDateTime(invoice.createdAt)}</Text>
      {invoice.customerName ? <Text>{invoice.customerName}</Text> : null}
      <Text size="xs" tone="muted">
        {itemCountLabel(invoice.items.length)}
      </Text>
    </View>
  );
  const total = (
    <View style={styles.total}>
      <Text size="base" weight="medium">
        Total
      </Text>
      <Text size="lg" weight="medium" tabular>
        {formatPrice(invoice.total)}
      </Text>
    </View>
  );
  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{ ...detailHeaderOptions, title: invoiceTitle(invoice.invoiceNumber) }}
      />
      <FlashList
        contentContainerStyle={{ paddingBottom: insets.bottom + space[6] }}
        data={invoice.items}
        ItemSeparatorComponent={RowSeparator}
        keyExtractor={keyOf}
        ListFooterComponent={total}
        ListHeaderComponent={summary}
        renderItem={renderItem}
      />
    </View>
  );
}

const InvoiceLine = React.memo(function InvoiceLine({
  name,
  detail,
  total,
}: {
  readonly name: string;
  readonly detail: string;
  readonly total: string;
}) {
  return (
    <View style={styles.line}>
      <View style={styles.lineBody}>
        <Text size="base" numberOfLines={2}>
          {name}
        </Text>
        <Text size="xs" tone="muted" numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <Text weight="medium" tabular>
        {total}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ground,
  },
  summary: {
    gap: space[1],
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  line: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  lineBody: {
    flex: 1,
    gap: 2,
  },
  total: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[4],
    paddingVertical: space[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
});
