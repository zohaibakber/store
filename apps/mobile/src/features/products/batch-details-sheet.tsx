import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, ScrollView, StyleSheet, View } from "react-native";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, ButtonText } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { expiryTimestamp } from "@/features/product-scanner/local-parser";
import { useColors } from "@/theme/colors";

type BatchDetailsSheetProps = {
  readonly visible: boolean;
  readonly productName: string;
  readonly isNewBatch: boolean;
  readonly initialBatchNumber: string;
  readonly initialExpiresAt: string;
  readonly saving: boolean;
  readonly saveError?: string | null;
  readonly onClose: () => void;
  readonly onSave: (details: {
    batchNumber: string | null;
    expiresAt: number | null;
  }) => Promise<void>;
};

export function BatchDetailsSheet({
  visible,
  productName,
  isNewBatch,
  initialBatchNumber,
  initialExpiresAt,
  saving,
  saveError,
  onClose,
  onSave,
}: BatchDetailsSheetProps) {
  const colors = useColors();
  const [batchNumber, setBatchNumber] = useState(initialBatchNumber);
  const [expiresAt, setExpiresAt] = useState(initialExpiresAt);
  const [error, setError] = useState<string | null>(null);
  const message = error ?? saveError;

  useEffect(() => {
    if (!visible) return;
    setBatchNumber(initialBatchNumber);
    setExpiresAt(initialExpiresAt);
    setError(null);
  }, [initialBatchNumber, initialExpiresAt, visible]);

  const submit = async () => {
    const expiry = expiresAt.trim() ? expiryTimestamp(expiresAt) : null;
    if (expiresAt.trim() && expiry === null) {
      setError("Use YYYY-MM-DD, YYYY-MM, DD-MM-YYYY, or MM/YY for the expiry.");
      return;
    }
    setError(null);
    await onSave({
      batchNumber: batchNumber.trim() || null,
      expiresAt: expiry,
    });
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="formSheet"
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
        style={[styles.root, { backgroundColor: colors.popover }]}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text variant="subheading">{isNewBatch ? "New batch" : "Batch details"}</Text>
            <Text tone="muted" variant="caption">
              {productName}
            </Text>
          </View>

          {message ? (
            <Alert variant="destructive">
              <AlertTitle>Check the batch</AlertTitle>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : null}

          <Field>
            <FieldLabel>Batch or lot number</FieldLabel>
            <Input
              autoCapitalize="characters"
              mono
              onChangeText={setBatchNumber}
              placeholder="BN-2048"
              value={batchNumber}
            />
          </Field>
          <Field>
            <FieldLabel>Expiry</FieldLabel>
            <Input
              autoCapitalize="none"
              mono
              onChangeText={setExpiresAt}
              placeholder="YYYY-MM-DD"
              value={expiresAt}
            />
            <FieldDescription>Leave blank when the pack has no printed expiry.</FieldDescription>
          </Field>

          <View style={styles.actions}>
            <Button isDisabled={saving} loading={saving} onPress={() => void submit()}>
              <ButtonText>{isNewBatch ? "Create batch" : "Save batch"}</ButtonText>
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

const styles = StyleSheet.create({
  actions: { gap: 8, paddingTop: 8 },
  content: { gap: 16, paddingBottom: 32, paddingHorizontal: 16, paddingTop: 20 },
  header: { gap: 4 },
  root: { flex: 1 },
});
