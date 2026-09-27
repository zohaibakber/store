import { useAtomValue } from "@effect/atom-react";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import type { Batch, Product, StockMovement } from "@store/contracts";
import {
  minuteClockAtom,
  stockPolicyAtom,
  summarizeProductStock,
  useCatalogProduct,
  useCatalogStockMovements,
} from "@store/inventory-react";
import { Stack, useRouter } from "expo-router";
import * as React from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, space } from "@/theme/tokens";
import { Text } from "@/ui/text";

import { ActionButton } from "../action-button";
import { detailHeaderOptions } from "../detail-header";
import { formatDateTime, formatExpiry, formatPrice } from "../format";
import { EmptyState, ListSkeleton, RowSeparator } from "../list-states";
import { movementDelta, movementLabel } from "./movement-text";
import { AttentionMark } from "./product-row";
import { ReceiveBatchSheet } from "./receive-batch-sheet";
import {
  attentionLabel,
  batchAttention,
  batchOnHand,
  onHandOf,
  productSubtitle,
  stockAttention,
} from "./stock-state";

const MOVEMENT_LIMIT = 50;
const SAVED_NOTICE_MILLIS = 4000;

type DetailItem =
  | { readonly type: "section"; readonly key: string; readonly title: string }
  | { readonly type: "batch"; readonly key: string; readonly batch: Batch }
  | { readonly type: "movement"; readonly key: string; readonly movement: StockMovement }
  | { readonly type: "empty"; readonly key: string; readonly text: string };

const keyOf = (item: DetailItem) => item.key;
const typeOf = (item: DetailItem) => item.type;

const batchOrder = (left: Batch, right: Batch) => {
  const leftStocked = left.packQuantity > 0 || left.unitQuantity > 0;
  const rightStocked = right.packQuantity > 0 || right.unitQuantity > 0;
  if (leftStocked !== rightStocked) return leftStocked ? -1 : 1;
  return (left.expiresAt ?? Number.MAX_SAFE_INTEGER) - (right.expiresAt ?? Number.MAX_SAFE_INTEGER);
};

export function ProductDetail({ productId }: { readonly productId: string }) {
  const product = useCatalogProduct(productId);
  if (product.data === undefined) {
    return (
      <>
        <Stack.Screen options={{ ...detailHeaderOptions, title: "" }} />
        {product.isLoading ? (
          <ListSkeleton label="Loading product" />
        ) : (
          <EmptyState
            title="Product not found"
            body="It may have been removed on another device."
          />
        )}
      </>
    );
  }
  return <ProductDetailBody product={product.data} />;
}

function ProductDetailBody({ product }: { readonly product: Product }) {
  const { push } = useRouter();
  const insets = useSafeAreaInsets();
  const movements = useCatalogStockMovements(product.id, MOVEMENT_LIMIT);
  const policy = useAtomValue(stockPolicyAtom);
  const now = useAtomValue(minuteClockAtom);
  const [receiving, setReceiving] = React.useState(false);
  const [saved, setSaved] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (saved === null) return;
    const timer = setTimeout(() => setSaved(null), SAVED_NOTICE_MILLIS);
    return () => clearTimeout(timer);
  }, [saved]);

  const onSaved = (summary: string) => {
    setReceiving(false);
    setSaved(summary);
  };
  const tracksPacks = product.category.tracksPacks;

  const stock = summarizeProductStock(product, product.batches, policy, now);
  const onHand = onHandOf(stock.onHandUnits, product.unitsPerPack, tracksPacks);
  const attention = stockAttention(stock, now);

  const items = React.useMemo((): ReadonlyArray<DetailItem> => {
    const batches = [...product.batches].sort(batchOrder);
    return [
      { type: "section", key: "section:batches", title: "Batches" },
      ...(batches.length === 0
        ? [{ type: "empty" as const, key: "empty:batches", text: "No batches yet." }]
        : batches.map((batch) => ({ type: "batch" as const, key: `batch:${batch.id}`, batch }))),
      { type: "section", key: "section:movements", title: "Recent movements" },
      ...(movements.data.length === 0
        ? [{ type: "empty" as const, key: "empty:movements", text: "No stock movements yet." }]
        : movements.data.map((movement) => ({
            type: "movement" as const,
            key: `movement:${movement.id}`,
            movement,
          }))),
    ];
  }, [movements.data, product.batches]);

  const openScan = () => push("/scan");

  const renderItem = ({ item }: ListRenderItemInfo<DetailItem>) => {
    switch (item.type) {
      case "section":
        return (
          <Text accessibilityRole="header" size="sm" weight="medium" style={styles.section}>
            {item.title}
          </Text>
        );
      case "empty":
        return (
          <Text tone="muted" style={styles.emptyRow}>
            {item.text}
          </Text>
        );
      case "batch": {
        const flag = batchAttention(item.batch.expiresAt, now);
        return (
          <DetailRow
            title={item.batch.batchNumber ?? "No batch number"}
            subtitle={
              item.batch.expiresAt === null
                ? "No expiry"
                : `Expires ${formatExpiry(item.batch.expiresAt)}`
            }
            flag={flag === null ? null : flag === "expired" ? "Expired" : "Expires soon"}
            trailing={batchOnHand(
              item.batch.packQuantity,
              item.batch.unitQuantity,
              product.unitsPerPack,
              tracksPacks,
            )}
          />
        );
      }
      case "movement":
        return (
          <DetailRow
            title={movementLabel(item.movement.type)}
            subtitle={
              item.movement.note
                ? `${formatDateTime(item.movement.createdAt)} · ${item.movement.note}`
                : formatDateTime(item.movement.createdAt)
            }
            flag={null}
            trailing={movementDelta(item.movement, product.unitsPerPack, tracksPacks)}
          />
        );
    }
  };

  const details = [product.category.name, product.aisle ? `Aisle ${product.aisle}` : null]
    .filter((part): part is string => part !== null)
    .join(" · ");
  const subtitle = productSubtitle(product);

  const summary = (
    <View style={styles.summary}>
      {subtitle.length > 0 ? <Text tone="muted">{subtitle}</Text> : null}
      <Text size="xs" tone="muted">
        {details}
      </Text>
      <View style={styles.onHand}>
        <Text size="2xl" weight="medium" tabular>
          {onHand.value}
        </Text>
        <Text tone="muted">{onHand.unit} on hand</Text>
      </View>
      {attention !== null ? <AttentionMark label={attentionLabel(attention)} /> : null}
      <Text size="xs" tone="muted">
        {`Retail ${formatPrice(product.retailPrice)}${tracksPacks && product.unitsPerPack > 1 ? " per pack" : ""}`}
      </Text>
      <View style={styles.actions}>
        <ActionButton label="Receive stock" onPress={() => setReceiving(true)} />
        <ActionButton label="Scan a pack" onPress={openScan} variant="outlined" />
      </View>
      {saved === null ? null : (
        <Text accessibilityLiveRegion="polite" size="xs" tone="synced">
          {`Saved · syncing. ${saved}.`}
        </Text>
      )}
    </View>
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ ...detailHeaderOptions, title: product.name }} />
      <FlashList
        contentContainerStyle={{ paddingBottom: insets.bottom + space[6] }}
        data={items}
        getItemType={typeOf}
        keyExtractor={keyOf}
        ListHeaderComponent={summary}
        renderItem={renderItem}
      />
      <ReceiveBatchSheet
        onClose={() => setReceiving(false)}
        onSaved={onSaved}
        open={receiving}
        productId={product.id}
        productName={product.name}
        tracksPacks={tracksPacks}
        unitsPerPack={product.unitsPerPack}
      />
    </View>
  );
}

const DetailRow = React.memo(function DetailRow({
  title,
  subtitle,
  flag,
  trailing,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly flag: string | null;
  readonly trailing: string;
}) {
  return (
    <View>
      <View style={styles.row}>
        <View style={styles.rowBody}>
          <Text size="base" numberOfLines={1}>
            {title}
          </Text>
          <Text size="xs" tone="muted" numberOfLines={2}>
            {subtitle}
          </Text>
          {flag !== null ? (
            <View style={styles.flag}>
              <AttentionMark label={flag} />
            </View>
          ) : null}
        </View>
        <Text weight="medium" tabular style={styles.trailing}>
          {trailing}
        </Text>
      </View>
      <RowSeparator />
    </View>
  );
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ground,
  },
  summary: {
    gap: space[2],
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  onHand: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: space[2],
    marginTop: space[2],
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
    marginTop: space[2],
  },
  section: {
    paddingHorizontal: space[4],
    paddingTop: space[6],
    paddingBottom: space[2],
  },
  emptyRow: {
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  row: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  flag: {
    flexDirection: "row",
    marginTop: space[1],
  },
  trailing: {
    maxWidth: 160,
    textAlign: "right",
  },
});
