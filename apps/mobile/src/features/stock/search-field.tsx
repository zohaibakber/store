import { Host, TextInput, type TextInputRef } from "@expo/ui";
import { fillMaxWidth } from "@expo/ui/jetpack-compose/modifiers";
import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import * as React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, fonts, radius, space, touch, type } from "@/theme/tokens";
import { Icon } from "@/ui/icon";

const inputModifiers = [fillMaxWidth()];
const inputText = {
  fontFamily: fonts.regular,
  fontSize: type.base.fontSize,
  lineHeight: type.base.lineHeight,
  color: colors.ink,
};

export function SearchField({
  placeholder,
  empty,
  onChangeText,
}: {
  readonly placeholder: string;
  readonly empty: boolean;
  readonly onChangeText: (text: string) => void;
}) {
  const input = React.useRef<TextInputRef>(null);
  const clear = () => {
    input.current?.clear();
    onChangeText("");
  };
  return (
    <View style={styles.bar}>
      <Icon icon={Search01Icon} size={20} color={colors.muted} />
      <Host matchContents={{ vertical: true }} style={styles.host}>
        <TextInput
          ref={input}
          autoCapitalize="none"
          autoCorrect={false}
          cursorColor={colors.ink}
          modifiers={inputModifiers}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.placeholder}
          returnKeyType="search"
          selectionColor={colors.highlight}
          textStyle={inputText}
        />
      </Host>
      {empty ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={clear}
          style={styles.clear}
        >
          <Icon icon={Cancel01Icon} size={20} color={colors.muted} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: touch.primary,
    marginHorizontal: space[4],
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingLeft: space[4],
    paddingRight: space[1],
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  host: {
    flex: 1,
  },
  clear: {
    width: touch.minimum,
    height: touch.minimum,
    alignItems: "center",
    justifyContent: "center",
  },
});
