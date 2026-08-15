import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  Alert,
  Button,
  Card,
  ChoiceChip,
  Input,
  Label,
  TextField,
  useThemeColor,
} from "@/components/mobile-ui";
import { useProductActions, useProductData } from "@/features/products/products-provider";
import { authErrorMessage } from "@/lib/auth-client";
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
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [composition, setComposition] = useState("");
  const [strength, setStrength] = useState("");
  const [aisle, setAisle] = useState("");
  const [unitsPerPack, setUnitsPerPack] = useState("1");
  const [packPrice, setPackPrice] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [background, foreground, muted, subtle, border] = useThemeColor([
    "background",
    "foreground",
    "muted",
    "surface-secondary",
    "separator",
  ]);

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
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.root, { backgroundColor: background }]}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.intro, { backgroundColor: subtle, borderColor: border }]}>
          <View style={styles.introIcon}>
            <MaterialIcons color={foreground} name="inventory-2" size={22} />
          </View>
          <View style={styles.introCopy}>
            <Text style={[styles.title, { color: foreground }]}>Create product</Text>
            <Text style={[styles.caption, { color: muted }]}>
              Add details now; batch and quantity can be updated afterward.
            </Text>
          </View>
        </View>

        {error ? (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Check the product</Alert.Title>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}

        <Card>
          <Card.Header>
            <Card.Title>Product details</Card.Title>
            <Card.Description>Name, category, composition, and shelf location</Card.Description>
          </Card.Header>
          <Card.Body style={styles.cardBody}>
            <TextField isRequired>
              <Label>Product name</Label>
              <Input autoFocus onChangeText={setName} placeholder="e.g. Panadol" value={name} />
            </TextField>

            <View style={styles.fieldGroup}>
              <Label>Category</Label>
              {categories.length > 0 ? (
                <View style={styles.chips}>
                  {categories.map((category) => (
                    <ChoiceChip
                      key={category.id}
                      onPress={() => setCategoryId(category.id)}
                      selected={categoryId === category.id}
                    >
                      {category.name}
                    </ChoiceChip>
                  ))}
                </View>
              ) : (
                <Text style={[styles.caption, { color: muted }]}>
                  The General category will be created automatically.
                </Text>
              )}
            </View>

            <TextField>
              <Label>Composition</Label>
              <Input
                onChangeText={setComposition}
                placeholder="Active ingredient"
                value={composition}
              />
            </TextField>
            <View style={styles.row}>
              <TextField style={styles.flex}>
                <Label>Strength</Label>
                <Input onChangeText={setStrength} placeholder="500mg" value={strength} />
              </TextField>
              <TextField style={styles.flex}>
                <Label>Aisle</Label>
                <Input onChangeText={setAisle} placeholder="A-12" value={aisle} />
              </TextField>
            </View>
          </Card.Body>
        </Card>

        <Card variant="secondary">
          <Card.Header>
            <Card.Title>Pack & pricing</Card.Title>
            <Card.Description>Prices are entered in PKR</Card.Description>
          </Card.Header>
          <Card.Body style={styles.cardBody}>
            {tracksPacks ? (
              <TextField isRequired>
                <Label>Units per pack</Label>
                <Input
                  keyboardType="number-pad"
                  onChangeText={setUnitsPerPack}
                  placeholder="1"
                  value={unitsPerPack}
                />
              </TextField>
            ) : null}
            <View style={styles.row}>
              {tracksPacks ? (
                <TextField style={styles.flex}>
                  <Label>Pack price</Label>
                  <Input keyboardType="decimal-pad" onChangeText={setPackPrice} value={packPrice} />
                </TextField>
              ) : null}
              <TextField style={styles.flex}>
                <Label>Unit price</Label>
                <Input keyboardType="decimal-pad" onChangeText={setUnitPrice} value={unitPrice} />
              </TextField>
            </View>
          </Card.Body>
        </Card>

        <Button isDisabled={saving} onPress={() => void save()}>
          {saving ? "Creating…" : "Create product"}
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  caption: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 20 },
  cardBody: { gap: 20 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  content: { gap: 24, paddingBottom: 48, paddingHorizontal: 20, paddingTop: 16 },
  fieldGroup: { gap: 8 },
  flex: { flex: 1 },
  intro: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    padding: 16,
  },
  introCopy: { flex: 1, gap: 2, minWidth: 0 },
  introIcon: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  root: { flex: 1 },
  row: { flexDirection: "row", gap: 12 },
  title: { fontFamily: "Inter_500Medium", fontSize: 16, lineHeight: 22 },
});
