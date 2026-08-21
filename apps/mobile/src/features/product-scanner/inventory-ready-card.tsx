import { StyleSheet, View } from "react-native";

import { Button, ButtonIcon, ButtonText } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Field, FieldLabel } from "@/components/ui/field";
import type { MobileProduct } from "@/lib/inventory-types";

type InventoryReadyCardProps = {
  product: MobileProduct;
  selectedBatchId: string | null;
  busy: boolean;
  onSelectBatch: (batchId: string | null) => void;
  onSetQuantity: () => void;
  onScanBatch: () => void;
};

export function InventoryReadyCard({
  product,
  selectedBatchId,
  busy,
  onSelectBatch,
  onSetQuantity,
  onScanBatch,
}: InventoryReadyCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Inventory</CardTitle>
        <CardDescription>Batch details and quantity are separate steps.</CardDescription>
      </CardHeader>
      <CardContent>
        {product.batches.length > 0 ? (
          <Field>
            <FieldLabel>Target batch</FieldLabel>
            <View style={styles.chips}>
              {product.batches.map((batch, index) => (
                <Chip
                  key={batch.id}
                  isSelected={selectedBatchId === batch.id}
                  onPress={() => onSelectBatch(batch.id)}
                >
                  {batch.batchNumber || `Batch ${index + 1}`}
                </Chip>
              ))}
              <Chip isSelected={selectedBatchId === null} onPress={() => onSelectBatch(null)}>
                New batch
              </Chip>
            </View>
          </Field>
        ) : null}
      </CardContent>
      <CardFooter style={styles.rowActions}>
        <Button isDisabled={busy} onPress={onSetQuantity} style={styles.flex}>
          <ButtonText>Set quantity</ButtonText>
        </Button>
        <Button isDisabled={busy} onPress={onScanBatch} style={styles.flex} variant="outline">
          <ButtonIcon name="camera" />
          <ButtonText>Scan batch</ButtonText>
        </Button>
      </CardFooter>
    </Card>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  flex: { flex: 1 },
  rowActions: { flexDirection: "row" },
});
