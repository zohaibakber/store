import { StyleSheet, TextInput, View } from "react-native";

import { Text } from "@/components/ui/text";
import { useColors } from "@/theme/colors";
import { radius } from "@/theme/tokens";

const SLOTS = [0, 1, 2, 3, 4, 5];
const digitsOnly = (value: string) => value.replace(/\D/gu, "").slice(0, SLOTS.length);

/**
 * Six slots for the eye, one real field for the system: autofill, paste and
 * VoiceOver all talk to the transparent input layered over the slots. The slot
 * awaiting a digit carries the `ring` border, the same focus signal `Input` uses.
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
  const colors = useColors();

  return (
    <View style={styles.root}>
      <View style={styles.slots}>
        {SLOTS.map((slot) => (
          <View
            key={slot}
            style={[
              styles.slot,
              {
                backgroundColor: colors.card,
                borderColor: slot === code.length ? colors.ring : colors.input,
              },
            ]}
          >
            <Text variant="monoMedium">{code[slot] ?? ""}</Text>
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
  input: { bottom: 0, left: 0, opacity: 0, position: "absolute", right: 0, top: 0 },
  root: { position: "relative" },
  slot: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: radius.lg,
    borderWidth: 1,
    flex: 1,
    height: 52,
    justifyContent: "center",
  },
  slots: { flexDirection: "row", gap: 8 },
});
