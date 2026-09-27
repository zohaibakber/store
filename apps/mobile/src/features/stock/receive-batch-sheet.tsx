import { BottomSheet, Host, RNHostView, TextInput } from "@expo/ui";
import { fillMaxWidth } from "@expo/ui/jetpack-compose/modifiers";
import { useInventoryActions } from "@store/inventory-react";
import * as Haptics from "expo-haptics";
import * as React from "react";
import { StyleSheet, View, type KeyboardTypeOptions } from "react-native";

import { colors, fonts, radius, space, touch, type } from "@/theme/tokens";
import { Text } from "@/ui/text";

import { ActionButton } from "../action-button";
import {
  emptyReceiveBatchFields,
  expiryHint,
  parseReceiveBatch,
  type ReceiveBatchField,
  type ReceiveBatchFields,
} from "./receive-batch";
import { batchOnHand } from "./stock-state";

const inputModifiers = [fillMaxWidth()];
const inputText = {
  fontFamily: fonts.regular,
  fontSize: type.base.fontSize,
  lineHeight: type.base.lineHeight,
  color: colors.ink,
};
const sheetPadding = { top: space[2], bottom: space[6], left: space[4], right: space[4] };

type SaveState =
  | { readonly _tag: "editing" }
  | { readonly _tag: "saving" }
  | { readonly _tag: "failed"; readonly message: string };

export function ReceiveBatchSheet({
  open,
  productId,
  productName,
  unitsPerPack,
  tracksPacks,
  onClose,
  onSaved,
}: {
  readonly open: boolean;
  readonly productId: string;
  readonly productName: string;
  readonly unitsPerPack: number;
  readonly tracksPacks: boolean;
  readonly onClose: () => void;
  readonly onSaved: (summary: string) => void;
}) {
  return (
    <BottomSheet
      containerColor={colors.ground}
      contentPadding={sheetPadding}
      isPresented={open}
      onDismiss={onClose}
    >
      <RNHostView matchContents>
        <ReceiveBatchForm
          onCancel={onClose}
          onSaved={onSaved}
          productId={productId}
          productName={productName}
          tracksPacks={tracksPacks}
          unitsPerPack={unitsPerPack}
        />
      </RNHostView>
    </BottomSheet>
  );
}

function ReceiveBatchForm({
  productId,
  productName,
  unitsPerPack,
  tracksPacks,
  onCancel,
  onSaved,
}: {
  readonly productId: string;
  readonly productName: string;
  readonly unitsPerPack: number;
  readonly tracksPacks: boolean;
  readonly onCancel: () => void;
  readonly onSaved: (summary: string) => void;
}) {
  const { receiveBatch } = useInventoryActions();
  const [fields, setFields] = React.useState<ReceiveBatchFields>(emptyReceiveBatchFields);
  const [showErrors, setShowErrors] = React.useState(false);
  const [save, setSave] = React.useState<SaveState>({ _tag: "editing" });
  const packsTracked = tracksPacks && unitsPerPack > 1;
  const parsed = parseReceiveBatch(fields);
  const errorFor = (field: ReceiveBatchField) =>
    showErrors && parsed._tag === "invalid" && parsed.field === field ? parsed.message : null;
  const edit = (field: ReceiveBatchField) => (text: string) =>
    setFields((current) => ({ ...current, [field]: text }));

  const received = (draft: { readonly packQuantity: number; readonly unitQuantity: number }) =>
    batchOnHand(draft.packQuantity, draft.unitQuantity, unitsPerPack, packsTracked);

  const submit = async () => {
    if (parsed._tag === "invalid") {
      setShowErrors(true);
      return;
    }
    setSave({ _tag: "saving" });
    try {
      await receiveBatch({ productId, ...parsed.draft });
    } catch (cause) {
      setSave({
        _tag: "failed",
        message:
          cause instanceof Error && cause.message ? cause.message : "Could not save this batch.",
      });
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSaved(`Added ${received(parsed.draft)}`);
  };

  const commitLabel = parsed._tag === "valid" ? `Add ${received(parsed.draft)}` : "Add to stock";

  return (
    <View style={styles.form}>
      <View style={styles.heading}>
        <Text size="lg" weight="medium">
          Receive stock
        </Text>
        <Text tone="muted" numberOfLines={1}>
          {productName}
        </Text>
      </View>
      <Field
        autoCapitalize="characters"
        label="Batch number"
        onChangeText={edit("batchNumber")}
        error={errorFor("batchNumber")}
      />
      <Field
        hint={expiryHint}
        keyboardType="numbers-and-punctuation"
        label="Expiry"
        onChangeText={edit("expiry")}
        error={errorFor("expiry")}
      />
      <View style={styles.quantities}>
        {packsTracked ? (
          <View style={styles.quantity}>
            <Field
              keyboardType="number-pad"
              label="Packs"
              onChangeText={edit("packs")}
              error={errorFor("packs")}
            />
          </View>
        ) : null}
        <View style={styles.quantity}>
          <Field
            keyboardType="number-pad"
            label={packsTracked ? "Loose units" : "Units"}
            onChangeText={edit("units")}
            error={errorFor("units") ?? (packsTracked ? null : errorFor("packs"))}
          />
        </View>
      </View>
      {save._tag === "failed" ? <Text tone="error">{save.message}</Text> : null}
      <View style={styles.actions}>
        <ActionButton label="Cancel" onPress={onCancel} variant="text" />
        <ActionButton
          disabled={save._tag === "saving"}
          label={commitLabel}
          onPress={() => void submit()}
        />
      </View>
    </View>
  );
}

function Field({
  label,
  hint,
  error,
  keyboardType,
  autoCapitalize = "none",
  onChangeText,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly error: string | null;
  readonly keyboardType?: KeyboardTypeOptions;
  readonly autoCapitalize?: "none" | "characters";
  readonly onChangeText: (text: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text size="xs" tone="muted">
        {label}
      </Text>
      <View style={[styles.input, error === null ? null : styles.inputInvalid]}>
        <Host matchContents={{ vertical: true }} style={styles.host}>
          <TextInput
            autoCapitalize={autoCapitalize}
            autoCorrect={false}
            cursorColor={colors.ink}
            keyboardType={keyboardType}
            modifiers={inputModifiers}
            onChangeText={onChangeText}
            selectionColor={colors.highlight}
            textStyle={inputText}
          />
        </Host>
      </View>
      {error !== null ? (
        <Text size="xs" tone="error">
          {error}
        </Text>
      ) : hint !== undefined ? (
        <Text size="xs" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: space[4],
  },
  heading: {
    gap: space[1],
  },
  field: {
    gap: space[1],
  },
  input: {
    minHeight: touch.primary,
    justifyContent: "center",
    paddingHorizontal: space[4],
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.ground,
  },
  inputInvalid: {
    borderColor: colors.error,
  },
  host: {
    alignSelf: "stretch",
  },
  quantities: {
    flexDirection: "row",
    gap: space[3],
  },
  quantity: {
    flex: 1,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: space[2],
  },
});
