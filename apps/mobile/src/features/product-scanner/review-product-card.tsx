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
import { Chip } from "@/components/ui/chip";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import type { ProductScanInference } from "@/features/product-scanner/types";
import type { MobileCategory, MobileProduct } from "@/lib/inventory-types";
import { useColors } from "@/theme/colors";
import { radius } from "@/theme/tokens";

export type ProductReviewDraft = {
  name: string;
  composition: string;
  strength: string;
  unitsPerPack: string;
  categoryId: string;
};

type ReviewProductCardProps = {
  inference: ProductScanInference;
  draft: ProductReviewDraft;
  matchedProduct: MobileProduct | null;
  categories: ReadonlyArray<MobileCategory>;
  selectedCategory: MobileCategory | null;
  busy: boolean;
  saving: boolean;
  onChangeDraft: (patch: Partial<ProductReviewDraft>) => void;
  onCreateNew: () => void;
  onConfirm: () => void;
  onScanAgain: () => void;
};

export function ReviewProductCard({
  inference,
  draft,
  matchedProduct,
  categories,
  selectedCategory,
  busy,
  saving,
  onChangeDraft,
  onCreateNew,
  onConfirm,
  onScanAgain,
}: ReviewProductCardProps) {
  const colors = useColors();

  return (
    <Card>
      <CardHeader style={styles.reviewHeader}>
        <View style={styles.headerCopy}>
          <CardTitle>Product</CardTitle>
          <CardDescription>Edit anything that looks off.</CardDescription>
        </View>
        <Badge variant={inference.source === "cloud" ? "secondary" : "warning"}>
          {inference.source === "cloud" ? "AI" : "On device"}
        </Badge>
      </CardHeader>
      <CardContent>
        <View style={[styles.match, { backgroundColor: colors.secondary }]}>
          <View style={styles.matchCopy}>
            <Text variant="label">
              {matchedProduct ? "Matched an existing product" : "New product"}
            </Text>
            <Text numberOfLines={1} tone="muted" variant="caption">
              {matchedProduct
                ? [matchedProduct.name, matchedProduct.details || matchedProduct.category]
                    .filter(Boolean)
                    .join(" · ")
                : "A new inventory record will be created"}
            </Text>
          </View>
          {matchedProduct ? (
            <Button onPress={onCreateNew} size="sm" variant="ghost">
              <ButtonText>Create new</ButtonText>
            </Button>
          ) : null}
        </View>

        <Field>
          <FieldLabel>Product name</FieldLabel>
          <Input
            onChangeText={(name) => onChangeDraft({ name })}
            placeholder="Product name"
            value={draft.name}
          />
        </Field>
        <Field>
          <FieldLabel>Composition</FieldLabel>
          <Input
            multiline
            numberOfLines={2}
            onChangeText={(composition) => onChangeDraft({ composition })}
            placeholder="Active ingredient"
            value={draft.composition}
          />
        </Field>
        <Field>
          <FieldLabel>Strength</FieldLabel>
          <Input
            onChangeText={(strength) => onChangeDraft({ strength })}
            placeholder="e.g. 500mg"
            value={draft.strength}
          />
        </Field>

        {!matchedProduct && selectedCategory?.tracksPacks !== false ? (
          <Field>
            <FieldLabel>Units per sealed pack</FieldLabel>
            <Input
              keyboardType="number-pad"
              mono
              onChangeText={(unitsPerPack) => onChangeDraft({ unitsPerPack })}
              placeholder="10"
              value={draft.unitsPerPack}
            />
          </Field>
        ) : null}

        {!matchedProduct ? (
          <Field>
            <FieldLabel>Category</FieldLabel>
            {categories.length > 0 ? (
              <View style={styles.chips}>
                {categories.map((category) => (
                  <Chip
                    key={category.id}
                    isSelected={draft.categoryId === category.id}
                    onPress={() => onChangeDraft({ categoryId: category.id })}
                  >
                    {category.name}
                  </Chip>
                ))}
              </View>
            ) : (
              <FieldDescription>
                A General category is created with this first product.
              </FieldDescription>
            )}
          </Field>
        ) : null}
      </CardContent>
      <CardFooter style={styles.rowActions}>
        <Button
          isDisabled={busy || saving}
          loading={saving}
          onPress={onConfirm}
          style={styles.flex}
        >
          <ButtonText>{matchedProduct ? "Confirm product" : "Create product"}</ButtonText>
        </Button>
        <Button
          isDisabled={busy || saving}
          onPress={onScanAgain}
          style={styles.flex}
          variant="ghost"
        >
          <ButtonText>Scan again</ButtonText>
        </Button>
      </CardFooter>
    </Card>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  flex: { flex: 1 },
  headerCopy: { flex: 1, gap: 4, minWidth: 0 },
  match: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: radius.lg,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  matchCopy: { flex: 1, gap: 2, minWidth: 0 },
  reviewHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  rowActions: { flexDirection: "row" },
});
