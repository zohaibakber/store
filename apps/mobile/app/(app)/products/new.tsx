import { Button, FieldGroup, Host, Picker, Text, TextInput, useNativeState } from "@expo/ui";
import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, StyleSheet, View } from "react-native";

import { Alert } from "@/components/ui/alert";
import { useProductActions, useProductData } from "@/features/products/products-provider";
import { authErrorMessage } from "@/lib/auth-client";
import { hapticSuccess } from "@/lib/haptics";
import { createInventoryEntityId } from "@/lib/products";
import { useAppColorScheme } from "@/theme/appearance";
import { colors, cssColor } from "@/theme/colors";

const priceInPaisa = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const amount = Number(trimmed);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
};

export default function NewProductScreen() {
  const { categories } = useProductData();
  const { saveScannedProduct } = useProductActions();
  const colorScheme = useAppColorScheme();
  const name = useNativeState("");
  const composition = useNativeState("");
  const strength = useNativeState("");
  const aisle = useNativeState("");
  const unitsPerPack = useNativeState("1");
  const packPrice = useNativeState("");
  const unitPrice = useNativeState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedCategory = categories.find((category) => category.id === categoryId);
  const tracksPacks = selectedCategory?.tracksPacks ?? true;

  const save = async () => {
    const parsedUnits = Number(unitsPerPack.value.trim());
    if (!name.value.trim()) {
      setError("Enter a product name.");
      return;
    }
    if (tracksPacks && (!Number.isSafeInteger(parsedUnits) || parsedUnits < 1)) {
      setError("Units per pack must be a positive whole number.");
      return;
    }
    if (
      (packPrice.value.trim() && priceInPaisa(packPrice.value) === null) ||
      (unitPrice.value.trim() && priceInPaisa(unitPrice.value) === null)
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
        name: name.value,
        categoryId: categoryId || undefined,
        aisle: aisle.value.trim() || null,
        composition: composition.value.trim() || null,
        strength: strength.value.trim() || null,
        unitsPerPack: tracksPacks ? parsedUnits : 1,
        packPrice: tracksPacks ? priceInPaisa(packPrice.value) : null,
        unitPrice: priceInPaisa(unitPrice.value),
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
      style={[styles.root, { backgroundColor: colors.systemGroupedBackground }]}
    >
      {error ? (
        <View style={styles.error}>
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Check the product</Alert.Title>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert>
        </View>
      ) : null}
      <Host
        colorScheme={colorScheme}
        seedColor={colors.systemBlue}
        style={styles.host}
        useViewportSizeMeasurement
      >
        <FieldGroup style={{ backgroundColor: colors.systemGroupedBackground }}>
          <FieldGroup.Section title="Product details">
            <TextInput autoFocus placeholder="Product name" value={name} />
            {categories.length > 0 ? (
              <Picker onValueChange={setCategoryId} selectedValue={categoryId}>
                {categories.map((category) => (
                  <Picker.Item key={category.id} label={category.name} value={category.id} />
                ))}
              </Picker>
            ) : (
              <Text textStyle={{ color: cssColor(colors.secondaryLabel), fontSize: 12 }}>
                The General category will be created automatically.
              </Text>
            )}
            <TextInput placeholder="Composition" value={composition} />
            <TextInput placeholder="Strength" value={strength} />
            <TextInput placeholder="Aisle" value={aisle} />
          </FieldGroup.Section>

          <FieldGroup.Section title="Pack & pricing">
            {tracksPacks ? (
              <TextInput
                keyboardType="number-pad"
                placeholder="Units per pack"
                value={unitsPerPack}
              />
            ) : null}
            {tracksPacks ? (
              <TextInput keyboardType="decimal-pad" placeholder="Pack price" value={packPrice} />
            ) : null}
            <TextInput keyboardType="decimal-pad" placeholder="Unit price" value={unitPrice} />
            <FieldGroup.SectionFooter>
              Prices are entered in PKR. Batch and quantity can be updated afterward.
            </FieldGroup.SectionFooter>
          </FieldGroup.Section>

          <FieldGroup.Section>
            <Button
              disabled={saving}
              label={saving ? "Creating…" : "Create product"}
              onPress={() => void save()}
            />
          </FieldGroup.Section>
        </FieldGroup>
      </Host>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  error: { paddingHorizontal: 16, paddingTop: 12 },
  host: { flex: 1 },
  root: { flex: 1 },
});
