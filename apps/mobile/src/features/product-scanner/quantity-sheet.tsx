import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from "react-native";

import { Alert as HeroAlert, Button, Input, Label, TextField } from "@/components/mobile-ui";

type QuantitySheetProps = {
  visible: boolean;
  productName: string;
  tracksPacks: boolean;
  initialPackQuantity: number;
  initialUnitQuantity: number;
  isNewBatch: boolean;
  saving: boolean;
  saveError?: string | null;
  onClose: () => void;
  onSave: (quantities: { packQuantity: number; unitQuantity: number }) => Promise<void>;
};

const wholeNumber = (value: string): number | null => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

export function QuantitySheet({
  visible,
  productName,
  tracksPacks,
  initialPackQuantity,
  initialUnitQuantity,
  isNewBatch,
  saving,
  saveError,
  onClose,
  onSave,
}: QuantitySheetProps) {
  const [packs, setPacks] = useState(String(initialPackQuantity));
  const [units, setUnits] = useState(String(initialUnitQuantity));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPacks(String(initialPackQuantity));
    setUnits(String(initialUnitQuantity));
    setError(null);
  }, [initialPackQuantity, initialUnitQuantity, visible]);

  const submit = async () => {
    const packQuantity = tracksPacks ? wholeNumber(packs) : initialPackQuantity;
    const unitQuantity = wholeNumber(units);
    if (packQuantity === null || unitQuantity === null) {
      setError("Enter non-negative whole numbers for the stock count.");
      return;
    }
    if (isNewBatch && packQuantity + unitQuantity < 1) {
      setError("Add at least one pack or unit when creating stock.");
      return;
    }
    setError(null);
    await onSave({ packQuantity, unitQuantity });
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle={Platform.OS === "ios" ? "formSheet" : "pageSheet"}
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 bg-background"
      >
        <ScrollView
          className="bg-background"
          contentContainerClassName="flex-grow gap-6 px-5 py-6"
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
        >
          <View className="gap-1.5">
            <Text className="text-lg font-medium text-foreground">Update quantity</Text>
            <Text className="text-sm leading-5 font-normal text-muted">
              Correct the physical count for {productName}. This is recorded as a stock adjustment.
            </Text>
          </View>

          <View className="gap-4">
            {tracksPacks ? (
              <TextField isRequired>
                <Label>Sealed packs</Label>
                <Input
                  keyboardType="number-pad"
                  onChangeText={setPacks}
                  placeholder="0"
                  returnKeyType="next"
                  selectTextOnFocus
                  value={packs}
                />
              </TextField>
            ) : null}
            <TextField isRequired>
              <Label>{tracksPacks ? "Loose units" : "Quantity"}</Label>
              <Input
                keyboardType="number-pad"
                onChangeText={setUnits}
                placeholder="0"
                returnKeyType="done"
                selectTextOnFocus
                value={units}
              />
            </TextField>
          </View>

          {error || saveError ? (
            <HeroAlert status="danger">
              <HeroAlert.Indicator />
              <HeroAlert.Content>
                <HeroAlert.Title>Check the quantity</HeroAlert.Title>
                <HeroAlert.Description>{error ?? saveError}</HeroAlert.Description>
              </HeroAlert.Content>
            </HeroAlert>
          ) : null}

          <View className="mt-auto gap-3 pt-3">
            <Button isDisabled={saving} onPress={() => void submit()}>
              {saving ? "Updating…" : "Update quantity"}
            </Button>
            <Button isDisabled={saving} variant="ghost" onPress={onClose}>
              Cancel
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
