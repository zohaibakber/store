import { useCallback, type Ref } from "react";
import {
  StyleSheet,
  TextInput,
  type KeyboardTypeOptions,
  type ReturnKeyTypeOptions,
  type TextInputProps,
} from "react-native";

import { useThemeColor } from "@/hooks/use-theme-color";

type InputProps = {
  accessibilityLabel?: string;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoComplete?: TextInputProps["autoComplete"];
  autoFocus?: boolean;
  editable?: boolean;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
  multiline?: boolean;
  numberOfLines?: number;
  onChangeText?: (text: string) => void;
  onSubmitEditing?: () => void;
  placeholder?: string;
  ref?: Ref<TextInput>;
  returnKeyType?: ReturnKeyTypeOptions;
  secureTextEntry?: boolean;
  selectTextOnFocus?: boolean;
  testID?: string;
  textContentType?: TextInputProps["textContentType"];
  value?: string;
};

export function Input({
  accessibilityLabel,
  autoCapitalize,
  autoComplete,
  autoFocus,
  editable,
  keyboardType,
  maxLength,
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
  const [surface, separator, muted, foreground, accent] = useThemeColor([
    "surface",
    "separator",
    "muted",
    "foreground",
    "accent",
  ]);
  const handleChangeText = useCallback(
    (next: string) => {
      onChangeText?.(next);
    },
    [onChangeText],
  );

  return (
    <TextInput
      accessibilityLabel={accessibilityLabel}
      autoCapitalize={autoCapitalize}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      editable={editable}
      keyboardType={keyboardType}
      maxLength={maxLength}
      multiline={multiline}
      numberOfLines={numberOfLines}
      onChangeText={handleChangeText}
      onSubmitEditing={onSubmitEditing}
      placeholder={placeholder}
      placeholderTextColor={muted}
      ref={ref}
      returnKeyType={returnKeyType}
      secureTextEntry={secureTextEntry}
      selectionColor={accent}
      selectTextOnFocus={selectTextOnFocus}
      style={[
        styles.input,
        multiline ? styles.multiline : styles.single,
        {
          backgroundColor: surface,
          borderColor: separator,
          color: foreground,
        },
      ]}
      testID={testID}
      textContentType={textContentType}
      value={value}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    alignSelf: "stretch",
    borderCurve: "continuous",
    borderRadius: 10,
    borderWidth: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 14,
  },
  multiline: { height: 96, paddingVertical: 12, textAlignVertical: "top" },
  single: { height: 52, paddingVertical: 0 },
});
