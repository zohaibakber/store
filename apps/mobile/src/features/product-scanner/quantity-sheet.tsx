import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  Alert as HeroAlert,
  Button,
  Input,
  Label,
  TextField,
  useThemeColor,
} from "@/components/mobile-ui";

type QuantitySheetProps = {
  visible: boolean;
  productName: string;
  initialPackQuantity: number;
  initialUnitQuantity: number;
  isNewBatch: boolean;
  saving: boolean;
  saveError?: string | null;
  onClose: () => void;
  onSave: (quantities: { packQuantity: number; unitQuantity: number }) => Promise<void>;
};

type QuantityMode = "packs" | "units";

const wholeNumber = (value: string): number | null => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

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
}: QuantitySheetProps & { mode: QuantityMode }) {
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
  const [background, foreground, muted] = useThemeColor(["background", "foreground", "muted"]);

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle={Platform.OS === "ios" ? "formSheet" : "pageSheet"}
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[styles.root, { backgroundColor: background }]}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: foreground }]}>Update quantity</Text>
            <Text style={[styles.description, { color: muted }]}>
              Correct the physical count for {productName}. This is recorded as a stock adjustment.
            </Text>
          </View>

          <View style={styles.fields}>
            {mode === "packs" ? (
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
              <Label>{mode === "packs" ? "Loose units" : "Quantity"}</Label>
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

          <View style={styles.actions}>
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

export function PackQuantitySheet(props: QuantitySheetProps) {
  return <QuantitySheet mode="packs" {...props} />;
}

export function UnitQuantitySheet(props: QuantitySheetProps) {
  return <QuantitySheet mode="units" {...props} />;
}

const styles = StyleSheet.create({
  actions: { gap: 12, marginTop: "auto", paddingTop: 12 },
  content: { flexGrow: 1, gap: 24, padding: 24 },
  description: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
  fields: { gap: 16 },
  header: { gap: 6 },
  root: { flex: 1 },
  title: { fontFamily: "Inter_500Medium", fontSize: 18, lineHeight: 24 },
});
