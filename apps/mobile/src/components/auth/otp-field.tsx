import { StyleSheet, Text, TextInput, View } from "react-native";

import { useThemeColor } from "@/hooks/use-theme-color";

const SLOTS = [0, 1, 2, 3, 4, 5];
const digitsOnly = (value: string) => value.replace(/\D/gu, "").slice(0, SLOTS.length);

/**
 * Six slots for the eye, one real field for the system: autofill, paste and
 * VoiceOver all talk to the transparent input layered over the slots.
 */
export function OtpField({
  code,
  editable,
  onChange,
}: {
  readonly code: string;
  readonly editable: boolean;
  readonly onChange: (value: string) => void;
}) {
  const [foreground, surface, separator, accent] = useThemeColor([
    "foreground",
    "surface",
    "separator",
    "accent",
  ]);

  return (
    <View style={styles.root}>
      <View style={styles.slots}>
        {SLOTS.map((slot) => (
          <View
            key={slot}
            style={[
              styles.slot,
              {
                backgroundColor: surface,
                borderColor: slot === code.length ? accent : separator,
              },
            ]}
          >
            <Text style={[styles.digit, { color: foreground }]}>{code[slot] ?? ""}</Text>
          </View>
        ))}
      </View>
      <TextInput
        accessibilityLabel="One-time code"
        autoComplete="one-time-code"
        autoFocus
        caretHidden
        editable={editable}
        keyboardType="number-pad"
        maxLength={SLOTS.length}
        onChangeText={(value) => onChange(digitsOnly(value))}
        style={styles.input}
        textContentType="oneTimeCode"
        value={code}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  digit: { fontFamily: "Inter_500Medium", fontSize: 18, lineHeight: 24 },
  input: { bottom: 0, left: 0, opacity: 0, position: "absolute", right: 0, top: 0 },
  root: { position: "relative" },
  slot: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    height: 56,
    justifyContent: "center",
  },
  slots: { flexDirection: "row", gap: 8 },
});
