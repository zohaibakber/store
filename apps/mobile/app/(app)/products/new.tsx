import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from "react-native";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, ButtonText } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SectionTitle } from "@/components/ui/text";
import { useProductActions, useProductData } from "@/features/products/products-provider";
import { authErrorMessage } from "@/lib/auth-client";
import { hapticSuccess } from "@/lib/haptics";
import { createInventoryEntityId } from "@/lib/products";
import { useColors } from "@/theme/colors";

const priceInPaisa = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const amount = Number(trimmed);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
};

export default function NewProductScreen() {
  const { categories } = useProductData();
  const { saveScannedProduct } = useProductActions();
  const colors = useColors();
  const [name, setName] = useState("");
  const [composition, setComposition] = useState("");
  const [strength, setStrength] = useState("");
  const [aisle, setAisle] = useState("");
  const [unitsPerPack, setUnitsPerPack] = useState("1");
  const [packPrice, setPackPrice] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedCategory = categories.find((category) => category.id === categoryId);
  const tracksPacks = selectedCategory?.tracksPacks ?? true;

  const save = async () => {
    const parsedUnits = Number(unitsPerPack.trim());
    if (!name.trim()) {
      setError("Enter a product name.");
      return;
    }
    if (tracksPacks && (!Number.isSafeInteger(parsedUnits) || parsedUnits < 1)) {
      setError("Units per pack must be a positive whole number.");
      return;
    }
    if (
      (packPrice.trim() && priceInPaisa(packPrice) === null) ||
      (unitPrice.trim() && priceInPaisa(unitPrice) === null)
    ) {
      setError("Prices must be valid non-negative amounts.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await saveScannedProduct({
        newProductId: createInventoryEntityId(),
        productId: null,
        name,
        categoryId: categoryId || undefined,
        aisle: aisle.trim() || null,
        composition: composition.trim() || null,
        strength: strength.trim() || null,
        unitsPerPack: tracksPacks ? parsedUnits : 1,
        packPrice: tracksPacks ? priceInPaisa(packPrice) : null,
        unitPrice: priceInPaisa(unitPrice),
      });
      hapticSuccess();
      router.back();
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
      style={[styles.root, { backgroundColor: colors.background }]}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      >
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Check the product</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <View style={styles.section}>
          <SectionTitle>Product</SectionTitle>
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input autoFocus onChangeText={setName} placeholder="Product name" value={name} />
          </Field>
          <Field>
            <FieldLabel>Category</FieldLabel>
            {categories.length > 0 ? (
              <View style={styles.chips}>
                {categories.map((category) => (
                  <Chip
                    key={category.id}
                    isSelected={category.id === categoryId}
                    onPress={() => setCategoryId(category.id)}
                  >
                    {category.name}
                  </Chip>
                ))}
              </View>
            ) : (
              <FieldDescription>A General category is created with this product.</FieldDescription>
            )}
          </Field>
          <Field>
            <FieldLabel>Composition</FieldLabel>
            <Input
              onChangeText={setComposition}
              placeholder="Active ingredient"
              value={composition}
            />
          </Field>
          <Field>
            <FieldLabel>Strength</FieldLabel>
            <Input onChangeText={setStrength} placeholder="e.g. 500mg" value={strength} />
          </Field>
          <Field>
            <FieldLabel>Aisle</FieldLabel>
            <Input onChangeText={setAisle} placeholder="Where it is shelved" value={aisle} />
          </Field>
        </View>

        <View style={styles.section}>
          <SectionTitle>Pack and pricing</SectionTitle>
          {tracksPacks ? (
            <Field>
              <FieldLabel>Units per sealed pack</FieldLabel>
              <Input
                keyboardType="number-pad"
                mono
                onChangeText={setUnitsPerPack}
                placeholder="1"
                value={unitsPerPack}
              />
            </Field>
          ) : null}
          {tracksPacks ? (
            <Field>
              <FieldLabel>Pack price</FieldLabel>
              <Input
                keyboardType="decimal-pad"
                mono
                onChangeText={setPackPrice}
                placeholder="0"
                value={packPrice}
              />
            </Field>
          ) : null}
          <Field>
            <FieldLabel>Unit price</FieldLabel>
            <Input
              keyboardType="decimal-pad"
              mono
              onChangeText={setUnitPrice}
              placeholder="0"
              value={unitPrice}
            />
            <FieldDescription>
              Prices are in PKR. Batch and quantity are set afterwards.
            </FieldDescription>
          </Field>
        </View>

        <Button isDisabled={saving} loading={saving} onPress={() => void save()}>
          <ButtonText>Create product</ButtonText>
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  content: { gap: 24, paddingBottom: 48, paddingHorizontal: 16, paddingTop: 12 },
  root: { flex: 1 },
  section: { gap: 12 },
});
