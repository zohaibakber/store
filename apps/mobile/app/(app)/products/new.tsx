import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from "react-native";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useProductActions, useProductData } from "@/features/products/products-provider";
import { useThemeColor } from "@/hooks/use-theme-color";
import { authErrorMessage } from "@/lib/auth-client";
import { hapticSuccess } from "@/lib/haptics";
import { createInventoryEntityId } from "@/lib/products";

const priceInPaisa = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const amount = Number(trimmed);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
};

export default function NewProductScreen() {
  const { categories } = useProductData();
  const { saveScannedProduct } = useProductActions();
  const background = useThemeColor("background");
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
      style={[styles.root, { backgroundColor: background }]}
    >
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        {error ? (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Check the product</Alert.Title>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}

        <View style={styles.section}>
          <Label>Product details</Label>
          <Input autoFocus onChangeText={setName} placeholder="Product name" value={name} />
          {categories.length > 0 ? (
            <View style={styles.chips}>
              {categories.map((category) => (
                <ChoiceChip
                  key={category.id}
                  onPress={() => setCategoryId(category.id)}
                  selected={category.id === categoryId}
                >
                  {category.name}
                </ChoiceChip>
              ))}
            </View>
          ) : (
            <Label>The General category will be created automatically.</Label>
          )}
          <Input onChangeText={setComposition} placeholder="Composition" value={composition} />
          <Input onChangeText={setStrength} placeholder="Strength" value={strength} />
          <Input onChangeText={setAisle} placeholder="Aisle" value={aisle} />
        </View>

        <View style={styles.section}>
          <Label>Pack & pricing</Label>
          {tracksPacks ? (
            <Input
              keyboardType="number-pad"
              onChangeText={setUnitsPerPack}
              placeholder="Units per pack"
              value={unitsPerPack}
            />
          ) : null}
          {tracksPacks ? (
            <Input
              keyboardType="decimal-pad"
              onChangeText={setPackPrice}
              placeholder="Pack price"
              value={packPrice}
            />
          ) : null}
          <Input
            keyboardType="decimal-pad"
            onChangeText={setUnitPrice}
            placeholder="Unit price"
            value={unitPrice}
          />
          <Label>Prices are entered in PKR. Batch and quantity can be updated afterward.</Label>
        </View>

        <Button isDisabled={saving} onPress={() => void save()}>
          {saving ? "Creating…" : "Create product"}
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  content: { gap: 24, paddingBottom: 40, paddingHorizontal: 16, paddingTop: 12 },
  root: { flex: 1 },
  section: { gap: 12 },
});
