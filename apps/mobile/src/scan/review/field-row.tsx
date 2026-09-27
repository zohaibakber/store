import { MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import * as React from "react";
import { Pressable, StyleSheet, TextInput, type TextInputProps, View } from "react-native";

import { colors, fonts, radius, space, touch, type } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";

type FieldRowProps = {
  readonly label: string;
  readonly value: string;
  readonly flag: string | null;
  readonly placeholder?: string;
  readonly keyboardType?: TextInputProps["keyboardType"];
  readonly autoCapitalize?: TextInputProps["autoCapitalize"];
  readonly onChange: (value: string) => void;
  readonly onFocus: () => void;
  readonly onConfirm: () => void;
};

export function FieldRow({
  label,
  value,
  flag,
  placeholder,
  keyboardType,
  autoCapitalize = "none",
  onChange,
  onFocus,
  onConfirm,
}: FieldRowProps) {
  const flagged = flag !== null;
  return (
    <View style={styles.row}>
      <Text size="xs" tone="muted">
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={flag ?? undefined}
        value={value}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        onChangeText={onChange}
        onFocus={onFocus}
        style={[styles.input, flagged && styles.flagged]}
      />
      {flagged ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${flag}. Confirm ${label}`}
          onPress={onConfirm}
          hitSlop={{ top: 12, bottom: 12 }}
          style={styles.reason}
        >
          <Text size="xs" tone="muted">
            {flag}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function StepperRow({
  label,
  value,
  unit,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly onChange: (value: number) => void;
}) {
  const decrease = React.useCallback(() => onChange(Math.max(1, value - 1)), [onChange, value]);
  const increase = React.useCallback(() => onChange(value + 1), [onChange, value]);
  return (
    <View style={styles.stepperRow}>
      <View style={styles.stepperLabel}>
        <Text size="xs" tone="muted">
          {label}
        </Text>
        <Text size="lg" weight="medium" tabular>
          {`${value} ${unit}`}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`One fewer ${unit}`}
        disabled={value <= 1}
        onPress={decrease}
        style={[styles.stepperButton, value <= 1 && styles.stepperDisabled]}
      >
        <Icon icon={MinusSignIcon} size={20} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`One more ${unit}`}
        onPress={increase}
        style={styles.stepperButton}
      >
        <Icon icon={PlusSignIcon} size={20} />
      </Pressable>
    </View>
  );
}

export function InfoRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.row}>
      <Text size="xs" tone="muted">
        {label}
      </Text>
      <Text size="base">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: space[1],
    paddingVertical: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  input: {
    ...type.base,
    fontFamily: fonts.regular,
    color: colors.ink,
    minHeight: touch.minimum - 8,
    paddingVertical: space[1],
    paddingHorizontal: 0,
  },
  flagged: {
    alignSelf: "flex-start",
    minWidth: 96,
    paddingHorizontal: space[2],
    borderRadius: radius.sm / 2,
    backgroundColor: colors.highlight,
  },
  reason: { alignSelf: "flex-start", paddingVertical: space[1] },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingVertical: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  stepperLabel: { flex: 1, gap: space[1] },
  stepperButton: {
    width: touch.minimum,
    height: touch.minimum,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  stepperDisabled: { opacity: 0.4 },
});
