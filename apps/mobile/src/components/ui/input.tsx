import { useCallback, type Ref } from "react";
import {
  StyleSheet,
  TextInput,
  type KeyboardTypeOptions,
  type ReturnKeyTypeOptions,
} from "react-native";

import { useThemeColor } from "@/hooks/use-theme-color";

type InputProps = {
  accessibilityLabel?: string;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoFocus?: boolean;
  editable?: boolean;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
  multiline?: boolean;
  numberOfLines?: number;
  onChangeText?: (text: string) => void;
  placeholder?: string;
  ref?: Ref<TextInput>;
  returnKeyType?: ReturnKeyTypeOptions;
  secureTextEntry?: boolean;
  selectTextOnFocus?: boolean;
  testID?: string;
  value?: string;
};

export function Input({
  accessibilityLabel,
  autoCapitalize,
  autoFocus,
  editable,
  keyboardType,
  maxLength,
  multiline,
  numberOfLines,
  onChangeText,
  placeholder,
  ref,
  returnKeyType,
  secureTextEntry,
  selectTextOnFocus,
  testID,
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
      autoFocus={autoFocus}
      editable={editable}
      keyboardType={keyboardType}
      maxLength={maxLength}
      multiline={multiline}
      numberOfLines={numberOfLines}
      onChangeText={handleChangeText}
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
