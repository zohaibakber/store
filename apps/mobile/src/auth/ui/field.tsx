import {
  Host,
  TextInput,
  type ObservableState,
  type TextInputProps,
  type TextInputRef,
} from "@expo/ui";
import { defaultMinSize, fillMaxWidth } from "@expo/ui/jetpack-compose/modifiers";
import * as React from "react";
import { View } from "react-native";

import { colors, fonts, radius, space, touch, type } from "@/theme/tokens";
import { Text } from "@/ui/text";

export type FieldProps = Pick<
  TextInputProps,
  | "autoCapitalize"
  | "autoComplete"
  | "autoCorrect"
  | "autoFocus"
  | "keyboardType"
  | "maxLength"
  | "onSubmitEditing"
  | "returnKeyType"
  | "secureTextEntry"
> & {
  readonly label: string;
  readonly state: ObservableState<string>;
  readonly onChangeText: (text: string) => void;
  readonly error?: string | null;
  readonly hint?: string;
  readonly editable?: boolean;
  readonly inputRef?: React.Ref<TextInputRef>;
};

const BORDER = 1;
const PADDING_VERTICAL = (touch.primary - type.base.lineHeight - BORDER * 2) / 2;

export function Field({
  label,
  state,
  onChangeText,
  error = null,
  hint,
  editable = true,
  inputRef,
  ...input
}: FieldProps) {
  const [focused, setFocused] = React.useState(false);
  const borderColor = error !== null ? colors.error : focused ? colors.ink : colors.hairline;

  return (
    <View style={{ gap: space[2] }}>
      <Text weight="medium">{label}</Text>
      <Host matchContents={{ vertical: true }} colorScheme="light" style={{ alignSelf: "stretch" }}>
        <TextInput
          {...input}
          ref={inputRef}
          value={state}
          onChangeText={onChangeText}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          cursorColor={colors.ink}
          selectionHandleColor={colors.ink}
          textStyle={{
            fontFamily: fonts.regular,
            fontSize: type.base.fontSize,
            lineHeight: type.base.lineHeight,
            color: editable ? colors.ink : colors.muted,
          }}
          style={{
            borderWidth: BORDER,
            borderColor,
            borderRadius: radius.md,
            backgroundColor: colors.ground,
            paddingHorizontal: space[4],
            paddingVertical: PADDING_VERTICAL,
          }}
          modifiers={[fillMaxWidth(), defaultMinSize({ minHeight: touch.primary })]}
        />
      </Host>
      {error !== null ? (
        <Text tone="error" accessibilityLiveRegion="polite">
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
