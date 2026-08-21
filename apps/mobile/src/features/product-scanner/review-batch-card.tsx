import { StyleSheet, View } from "react-native";

import { Badge } from "@/components/ui/badge";
import { Button, ButtonText } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ProductScanInference } from "@/features/product-scanner/types";

type ReviewBatchCardProps = {
  inference: ProductScanInference;
  productName: string;
  batchNumber: string;
  expiresAt: string;
  busy: boolean;
  saving: boolean;
  onChangeBatchNumber: (value: string) => void;
  onChangeExpiresAt: (value: string) => void;
  onConfirm: () => void;
  onScanAgain: () => void;
};

export function ReviewBatchCard({
  inference,
  productName,
  batchNumber,
  expiresAt,
  busy,
  saving,
  onChangeBatchNumber,
  onChangeExpiresAt,
  onConfirm,
  onScanAgain,
}: ReviewBatchCardProps) {
  return (
    <Card>
      <CardHeader style={styles.reviewHeader}>
        <View style={styles.headerCopy}>
          <CardTitle>Batch</CardTitle>
          <CardDescription>{productName}</CardDescription>
        </View>
        <Badge variant={inference.source === "cloud" ? "secondary" : "warning"}>
          {inference.source === "cloud" ? "AI" : "On device"}
        </Badge>
      </CardHeader>
      <CardContent>
        <Field>
          <FieldLabel>Batch or lot number</FieldLabel>
          <Input
            autoCapitalize="characters"
            mono
            onChangeText={onChangeBatchNumber}
            placeholder="BN-2048"
            value={batchNumber}
          />
        </Field>
        <Field>
          <FieldLabel>Expiry</FieldLabel>
          <Input
            autoCapitalize="none"
            mono
            onChangeText={onChangeExpiresAt}
            placeholder="YYYY-MM-DD"
            value={expiresAt}
          />
        </Field>
      </CardContent>
      <CardFooter style={styles.rowActions}>
        <Button
          isDisabled={busy || saving}
          loading={saving}
          onPress={onConfirm}
          style={styles.flex}
        >
          <ButtonText>Save batch</ButtonText>
        </Button>
        <Button isDisabled={busy || saving} onPress={onScanAgain} style={styles.flex} variant="ghost">
          <ButtonText>Scan again</ButtonText>
        </Button>
      </CardFooter>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerCopy: { flex: 1, gap: 4, minWidth: 0 },
  reviewHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  rowActions: { flexDirection: "row" },
});
