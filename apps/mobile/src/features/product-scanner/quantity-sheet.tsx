import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, ScrollView, StyleSheet, View } from "react-native";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, ButtonText } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useColors } from "@/theme/colors";

type QuantitySheetProps = {
  readonly visible: boolean;
  readonly productName: string;
  readonly initialPackQuantity: number;
  readonly initialUnitQuantity: number;
  readonly isNewBatch: boolean;
  readonly saving: boolean;
  readonly saveError?: string | null;
  readonly onClose: () => void;
  readonly onSave: (quantities: {
    packQuantity: number;
    unitQuantity: number;
  }) => Promise<void>;
};

type QuantityMode = "packs" | "units";

const wholeNumber = (value: string): number | null => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

/**
 * A native form sheet, not a JS bottom sheet: the drag-to-dismiss, the keyboard
 * avoidance and the detents are the platform's. Surface `popover`, one primary
 * action, one `ghost` dismiss. See `design-system.md` §5.
 */
function QuantitySheet({
  mode,
  visible,
  productName,
  initialPackQuantity,
  initialUnitQuantity,
  isNewBatch,
  saving,
  saveError,
  onClose,
  onSave,
}: QuantitySheetProps & { readonly mode: QuantityMode }) {
  const colors = useColors();
  const [packs, setPacks] = useState(String(initialPackQuantity));
  const [units, setUnits] = useState(String(initialUnitQuantity));
  const [error, setError] = useState<string | null>(null);
  const message = error ?? saveError;

  useEffect(() => {
    if (!visible) return;
    setPacks(String(initialPackQuantity));
    setUnits(String(initialUnitQuantity));
    setError(null);
  }, [initialPackQuantity, initialUnitQuantity, visible]);

  const submit = async () => {
    const packQuantity = mode === "packs" ? wholeNumber(packs) : initialPackQuantity;
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
      presentationStyle={process.env.EXPO_OS === "ios" ? "formSheet" : "pageSheet"}
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
        style={[styles.root, { backgroundColor: colors.popover }]}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text variant="heading">Update quantity</Text>
            <Text selectable tone="muted" variant="body">
              Correct the physical count for {productName}. This is recorded as a stock adjustment.
            </Text>
          </View>

          <View style={styles.fields}>
            {mode === "packs" ? (
              <Field>
                <FieldLabel>Sealed packs</FieldLabel>
                <Input
                  keyboardType="number-pad"
                  mono
                  onChangeText={setPacks}
                  placeholder="0"
                  returnKeyType="next"
                  selectTextOnFocus
                  value={packs}
                />
              </Field>
            ) : null}
            <Field>
              <FieldLabel>{mode === "packs" ? "Loose units" : "Quantity"}</FieldLabel>
              <Input
                keyboardType="number-pad"
                mono
                onChangeText={setUnits}
                onSubmitEditing={() => void submit()}
                placeholder="0"
                returnKeyType="done"
                selectTextOnFocus
                value={units}
              />
            </Field>
          </View>

          {message ? (
            <Alert variant="destructive">
              <AlertTitle>Check the quantity</AlertTitle>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : null}

          <View style={styles.actions}>
            <Button isDisabled={saving} loading={saving} onPress={() => void submit()}>
              <ButtonText>Update quantity</ButtonText>
            </Button>
            <Button isDisabled={saving} onPress={onClose} variant="ghost">
              <ButtonText>Cancel</ButtonText>
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function PackQuantitySheet(props: QuantitySheetProps) {
  return <QuantitySheet mode="packs" {...props} />;
}

export function UnitQuantitySheet(props: QuantitySheetProps) {
  return <QuantitySheet mode="units" {...props} />;
}

const styles = StyleSheet.create({
  actions: { gap: 8, marginTop: "auto", paddingTop: 12 },
  content: { flexGrow: 1, gap: 24, padding: 24 },
  fields: { gap: 12 },
  header: { gap: 6 },
  root: { flex: 1 },
});
