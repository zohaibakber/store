import { useState, type Ref } from "react";
import {
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type ReturnKeyTypeOptions,
  type TextInputProps,
} from "react-native";

import { Icon, type IconName } from "@/components/ui/icon";
import { useColors } from "@/theme/colors";
import { alpha, radius, size as sizes } from "@/theme/tokens";
import { typography } from "@/theme/typography";

type InputProps = {
  readonly accessibilityLabel?: string;
  readonly autoCapitalize?: "none" | "sentences" | "words" | "characters";
  readonly autoComplete?: TextInputProps["autoComplete"];
  readonly autoFocus?: boolean;
  readonly editable?: boolean;
  readonly invalid?: boolean;
  readonly keyboardType?: KeyboardTypeOptions;
  /** Leading affordance, e.g. the magnifier in a search field. */
  readonly leadingIcon?: IconName;
  readonly maxLength?: number;
  readonly mono?: boolean;
  readonly multiline?: boolean;
  readonly numberOfLines?: number;
  readonly onChangeText?: (text: string) => void;
  readonly onSubmitEditing?: () => void;
  readonly placeholder?: string;
  readonly ref?: Ref<TextInput>;
  readonly returnKeyType?: ReturnKeyTypeOptions;
  readonly secureTextEntry?: boolean;
  readonly selectTextOnFocus?: boolean;
  readonly testID?: string;
  readonly textContentType?: TextInputProps["textContentType"];
  readonly value?: string;
};

/**
 * A single-line (or short multiline) text control. Border, not fill, carries
 * state: `input` at rest, `ring` on focus, tinted `destructive` when invalid.
 * The caret and selection are `foreground`, never a platform accent.
 */
export function Input({
  accessibilityLabel,
  autoCapitalize,
  autoComplete,
  autoFocus,
  editable = true,
  invalid = false,
  keyboardType,
  leadingIcon,
  maxLength,
  mono = false,
  multiline,
  numberOfLines,
  onChangeText,
  onSubmitEditing,
  placeholder,
  ref,
  returnKeyType,
  secureTextEntry,
  selectTextOnFocus,
  testID,
  textContentType,
  value = "",
}: InputProps) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  const borderColor = invalid
    ? alpha(colors.destructive, 0.4)
    : focused
      ? colors.ring
      : colors.input;

  return (
    <View
      style={[
        styles.shell,
        multiline ? styles.multiline : styles.single,
        { backgroundColor: colors.card, borderColor },
      ]}
    >
      {leadingIcon ? <Icon name={leadingIcon} tone="muted" /> : null}
      <TextInput
        accessibilityLabel={accessibilityLabel}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        cursorColor={colors.foreground}
        editable={editable}
        keyboardType={keyboardType}
        maxLength={maxLength}
        multiline={multiline}
        numberOfLines={numberOfLines}
        onBlur={() => setFocused(false)}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onSubmitEditing={onSubmitEditing}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        ref={ref}
        returnKeyType={returnKeyType}
        secureTextEntry={secureTextEntry}
        selectionColor={colors.foreground}
        selectTextOnFocus={selectTextOnFocus}
        style={[
          mono ? typography.mono : typography.body,
          styles.control,
          multiline && styles.controlMultiline,
          { color: colors.foreground },
        ]}
        testID={testID}
        textContentType={textContentType}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  control: { flex: 1, minWidth: 0, padding: 0 },
  controlMultiline: { textAlignVertical: "top" },
  multiline: { alignItems: "flex-start", height: 96, paddingVertical: 12 },
  shell: {
    alignItems: "center",
    alignSelf: "stretch",
    borderCurve: "continuous",
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
  },
  single: { height: sizes.control },
});
