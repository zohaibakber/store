import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";

import {
  Alert,
  Button,
  Card,
  Chip,
  Input,
  Label,
  TextField,
  useThemeColor,
} from "@/components/mobile-ui";
import { useProducts } from "@/features/products/products-provider";
import { authErrorMessage } from "@/lib/auth-client";
import { createInventoryEntityId } from "@/lib/products";

const priceInPaisa = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const amount = Number(trimmed);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
};

export default function NewProductScreen() {
  const { categories, saveScannedProduct } = useProducts();
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
  const blue = useThemeColor("blue");

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
      className="flex-1 bg-background"
    >
      <ScrollView
        className="bg-background"
        contentContainerClassName="gap-6 px-5 pt-4 pb-12"
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
        <View className="border-blue/15 bg-blue-soft flex-row items-center gap-3 rounded-3xl border px-4 py-4">
          <View className="bg-blue/12 size-11 items-center justify-center rounded-2xl">
            <MaterialIcons color={blue} name="inventory-2" size={22} />
          </View>
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-base font-medium text-foreground">Create product</Text>
            <Text className="text-foreground-secondary text-xs leading-5">
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
          <Card.Body className="gap-5">
            <TextField isRequired>
              <Label>Product name</Label>
              <Input autoFocus onChangeText={setName} placeholder="e.g. Panadol" value={name} />
            </TextField>

            <View className="gap-2">
              <Label>Category</Label>
              {categories.length > 0 ? (
                <View className="flex-row flex-wrap gap-2">
                  {categories.map((category) => (
                    <Chip
                      key={category.id}
                      color={categoryId === category.id ? "accent" : "default"}
                      onPress={() => setCategoryId(category.id)}
                    >
                      {category.name}
                    </Chip>
                  ))}
                </View>
              ) : (
                <Text className="text-xs leading-5 text-muted">
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
            <View className="flex-row gap-3">
              <TextField className="flex-1">
                <Label>Strength</Label>
                <Input onChangeText={setStrength} placeholder="500mg" value={strength} />
              </TextField>
              <TextField className="flex-1">
                <Label>Aisle</Label>
                <Input onChangeText={setAisle} placeholder="A-12" value={aisle} />
              </TextField>
            </View>
          </Card.Body>
        </Card>

        <Card variant="accent">
          <Card.Header>
            <Card.Title>Pack & pricing</Card.Title>
            <Card.Description>Prices are entered in PKR</Card.Description>
          </Card.Header>
          <Card.Body className="gap-5">
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
            <View className="flex-row gap-3">
              {tracksPacks ? (
                <TextField className="flex-1">
                  <Label>Pack price</Label>
                  <Input keyboardType="decimal-pad" onChangeText={setPackPrice} value={packPrice} />
                </TextField>
              ) : null}
              <TextField className="flex-1">
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
