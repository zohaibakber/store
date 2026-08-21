import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonIcon, ButtonText } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Row, RowChevron, RowGroup, RowValue } from "@/components/ui/row";
import { SectionTitle, Text } from "@/components/ui/text";
import { expiryInputValue } from "@/features/product-scanner/local-parser";
import { PackQuantitySheet, UnitQuantitySheet } from "@/features/product-scanner/quantity-sheet";
import { BatchDetailsSheet } from "@/features/products/batch-details-sheet";
import { useProductData } from "@/features/products/products-provider";
import { useBatchWrites } from "@/features/products/use-batch-writes";
import { hapticSuccess } from "@/lib/haptics";
import { createInventoryEntityId } from "@/lib/inventory-session";
import { formatPrice } from "@/lib/inventory-snapshot";
import type { MobileBatch } from "@/lib/inventory-types";
import { useColors } from "@/theme/colors";
import { radius } from "@/theme/tokens";

const batchStockLabel = (batch: MobileBatch, tracksPacks: boolean) => {
  if (!tracksPacks) return `${batch.unitQuantity} units`;
  const packs = `${batch.packQuantity} ${batch.packQuantity === 1 ? "pack" : "packs"}`;
  return batch.unitQuantity > 0 ? `${packs} · ${batch.unitQuantity} loose` : packs;
};

const batchExpiryLabel = (batch: MobileBatch) => {
  const value = expiryInputValue(batch.expiresAt);
  return value ? `Exp ${value}` : "No expiry";
};

export function ProductDetailScreen() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const { products } = useProductData();
  const { pending, writeBatchDetails, writeBatchQuantity } = useBatchWrites();
  const colors = useColors();
  const product = products.find((candidate) => candidate.id === productId) ?? null;

  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [newBatchId, setNewBatchId] = useState(createInventoryEntityId);
  const [quantityOpen, setQuantityOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedBatch = product?.batches.find((batch) => batch.id === selectedBatchId) ?? null;

  const openQuantity = (batchId: string | null) => {
    setError(null);
    setNotice(null);
    if (batchId === null) setNewBatchId(createInventoryEntityId());
    setSelectedBatchId(batchId);
    setQuantityOpen(true);
  };

  const openDetails = (batchId: string | null) => {
    setError(null);
    setNotice(null);
    if (batchId === null) setNewBatchId(createInventoryEntityId());
    setSelectedBatchId(batchId);
    setDetailsOpen(true);
  };

  const confirmQuantity = async (quantities: { packQuantity: number; unitQuantity: number }) => {
    if (!product) return;
    setError(null);
    const result = await writeBatchQuantity({
      productId: product.id,
      selectedBatchId,
      newBatchId,
      ...quantities,
    });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSelectedBatchId(result.batch.id);
    setQuantityOpen(false);
    setNotice("Quantity updated.");
    hapticSuccess();
  };

  const confirmDetails = async (details: {
    batchNumber: string | null;
    expiresAt: number | null;
  }) => {
    if (!product) return;
    setError(null);
    const creating = selectedBatchId === null;
    const result = await writeBatchDetails({
      productId: product.id,
      selectedBatchId,
      newBatchId,
      ...details,
    });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSelectedBatchId(result.batch.id);
    setDetailsOpen(false);
    setNotice(creating ? "Batch created. Set the quantity next." : "Batch details saved.");
    hapticSuccess();
    if (creating) openQuantity(result.batch.id);
  };

  if (!product) {
    return (
      <>
        <Stack.Screen options={{ title: "Product" }} />
        <View style={[styles.root, styles.centered, { backgroundColor: colors.background }]}>
          <Empty>
            <EmptyMedia name="box" />
            <EmptyTitle>Product not found</EmptyTitle>
            <EmptyDescription>It may have been removed, or is still syncing.</EmptyDescription>
            <Button onPress={() => router.back()} size="sm" variant="outline">
              <ButtonText>Back to products</ButtonText>
            </Button>
          </Empty>
        </View>
      </>
    );
  }

  const stockTone = product.stock === 0 ? "destructive" : product.stock <= 10 ? "warning" : "muted";
  const detailRows = [
    { label: "Category", value: product.category },
    { label: "Composition", value: product.composition },
    { label: "Strength", value: product.strength },
    { label: "Aisle", value: product.aisle ? `Aisle ${product.aisle}` : null },
    product.tracksPacks ? { label: "Units per pack", value: String(product.unitsPerPack) } : null,
    product.tracksPacks ? { label: "Pack price", value: formatPrice(product.packPrice) } : null,
    {
      label: product.tracksPacks ? "Unit price" : "Price",
      value: formatPrice(product.unitPrice),
    },
  ].filter((row): row is { label: string; value: string } => Boolean(row?.value));

  return (
    <>
      <Stack.Screen options={{ title: product.name }} />
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: colors.background }}
      >
        <View style={[styles.hero, { backgroundColor: colors.secondary }]}>
          <View style={styles.heroCopy}>
            <Text variant="subheading">{product.name}</Text>
            {product.details ? (
              <Text tone="muted" variant="caption">
                {product.details}
              </Text>
            ) : null}
          </View>
          <View style={styles.heroMeta}>
            <Text tone={stockTone} variant="bodyMedium">
              {product.stockLabel}
            </Text>
            {product.visible ? null : <Badge>Hidden</Badge>}
          </View>
        </View>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Needs attention</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {notice ? (
          <Alert variant="success">
            <AlertTitle>Saved</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}

        {detailRows.length > 0 ? (
          <View style={styles.section}>
            <SectionTitle>Details</SectionTitle>
            <RowGroup>
              {detailRows.map((row) => (
                <Row
                  key={row.label}
                  title={row.label}
                  trailing={<RowValue>{row.value}</RowValue>}
                />
              ))}
            </RowGroup>
          </View>
        ) : null}

        <View style={styles.section}>
          <SectionTitle>Batches</SectionTitle>
          <RowGroup>
            {product.batches.map((batch, index) => {
              const selected = selectedBatchId === batch.id;
              return (
                <Row
                  key={batch.id}
                  accessibilityHint="Select this batch for quantity or details"
                  onPress={() => setSelectedBatchId(batch.id)}
                  supporting={[batchExpiryLabel(batch), batchStockLabel(batch, product.tracksPacks)]
                    .filter(Boolean)
                    .join(" · ")}
                  title={batch.batchNumber || `Batch ${index + 1}`}
                  trailing={
                    <>
                      {selected ? <Badge variant="secondary">Selected</Badge> : null}
                      <RowChevron />
                    </>
                  }
                />
              );
            })}
            {product.batches.length === 0 ? (
              <Row supporting="Add a batch to track quantity and expiry." title="No batches yet" />
            ) : null}
            <Row
              accessibilityHint="Create a new batch for this product"
              onPress={() => openDetails(null)}
              title="Add batch"
              trailing={<RowChevron />}
            />
          </RowGroup>
        </View>

        <View style={styles.actions}>
          <Button onPress={() => openQuantity(selectedBatchId ?? product.batches[0]?.id ?? null)}>
            <ButtonText>Set quantity</ButtonText>
          </Button>
          <Button
            onPress={() => openDetails(selectedBatchId ?? product.batches[0]?.id ?? null)}
            variant="outline"
          >
            <ButtonText>
              {selectedBatch || product.batches[0] ? "Edit batch details" : "Add batch details"}
            </ButtonText>
          </Button>
          <Button onPress={() => router.push("/products/scan")} variant="outline">
            <ButtonIcon name="camera" />
            <ButtonText>Scan label</ButtonText>
          </Button>
        </View>
      </ScrollView>

      <BatchDetailsSheet
        initialBatchNumber={selectedBatch?.batchNumber ?? ""}
        initialExpiresAt={expiryInputValue(selectedBatch?.expiresAt ?? null)}
        isNewBatch={selectedBatchId === null}
        onClose={() => setDetailsOpen(false)}
        onSave={confirmDetails}
        productName={product.name}
        saveError={error}
        saving={pending === "batch"}
        visible={detailsOpen}
      />

      {product.tracksPacks ? (
        <PackQuantitySheet
          initialPackQuantity={selectedBatch?.packQuantity ?? 0}
          initialUnitQuantity={selectedBatch?.unitQuantity ?? 0}
          isNewBatch={selectedBatchId === null}
          onClose={() => setQuantityOpen(false)}
          onSave={confirmQuantity}
          productName={product.name}
          saveError={error}
          saving={pending === "quantity"}
          visible={quantityOpen}
        />
      ) : (
        <UnitQuantitySheet
          initialPackQuantity={selectedBatch?.packQuantity ?? 0}
          initialUnitQuantity={selectedBatch?.unitQuantity ?? 0}
          isNewBatch={selectedBatchId === null}
          onClose={() => setQuantityOpen(false)}
          onSave={confirmQuantity}
          productName={product.name}
          saveError={error}
          saving={pending === "quantity"}
          visible={quantityOpen}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 10 },
  centered: { alignItems: "center", justifyContent: "center", padding: 24 },
  content: { gap: 24, paddingBottom: 48, paddingHorizontal: 16, paddingTop: 12 },
  hero: {
    borderCurve: "continuous",
    borderRadius: radius.xl,
    gap: 12,
    padding: 16,
  },
  heroCopy: { gap: 4 },
  heroMeta: { alignItems: "center", flexDirection: "row", gap: 8 },
  root: { flex: 1 },
  section: { gap: 8 },
});
