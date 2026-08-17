import { Host, TextInput as ExpoTextInput, type TextInputRef, useNativeState } from "@expo/ui";
import { useCallback, useRef, type Ref } from "react";
import { StyleSheet, type KeyboardTypeOptions, type ReturnKeyTypeOptions } from "react-native";
import { scheduleOnRN } from "react-native-worklets";

import { useThemeColor } from "@/hooks/use-theme-color";
import { useAppColorScheme } from "@/theme/appearance";
import { colors, cssColor } from "@/theme/colors";

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
  ref?: Ref<TextInputRef>;
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
  const colorScheme = useAppColorScheme();
  const nativeValue = useNativeState(value);
  const lastExternalValue = useRef(value);
  const [surface, separator, muted, foreground, accent] = useThemeColor([
    "surface",
    "separator",
    "muted",
    "foreground",
    "accent",
  ]);

  if (value !== lastExternalValue.current) {
    lastExternalValue.current = value;
    nativeValue.value = value;
  }

  const handleChangeText = useCallback(
    (next: string) => {
      "worklet";
      nativeValue.value = next;
      if (onChangeText) scheduleOnRN(onChangeText, next);
    },
    [nativeValue, onChangeText],
  );

  return (
    <Host
      accessibilityLabel={accessibilityLabel}
      accessible={Boolean(accessibilityLabel)}
      colorScheme={colorScheme}
      matchContents={{ vertical: true }}
      seedColor={colors.systemBlue}
      style={multiline ? styles.inputHostMultiline : styles.inputHost}
    >
      <ExpoTextInput
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
        selectTextOnFocus={selectTextOnFocus}
        selectionColor={accent}
        style={{
          backgroundColor: surface,
          borderColor: separator,
          borderRadius: 10,
          borderWidth: 1,
          height: multiline ? 96 : 52,
          paddingHorizontal: 14,
          paddingVertical: multiline ? 12 : 0,
        }}
        testID={testID}
        textStyle={{
          color: cssColor(foreground),
          fontFamily: "Inter_400Regular",
          fontSize: 14,
          lineHeight: 20,
        }}
        value={nativeValue}
      />
    </Host>
  );
}

const styles = StyleSheet.create({
  inputHost: {
    alignSelf: "stretch",
    height: 52,
  },
  inputHostMultiline: {
    alignSelf: "stretch",
    height: 96,
  },
});
