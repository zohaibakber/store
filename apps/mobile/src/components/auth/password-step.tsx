import { StyleSheet, View } from "react-native";

import { StepHeader } from "@/components/auth/auth-shell";
import { QuietAction, QuietActions } from "@/components/auth/quiet-action";
import { Button, ButtonText } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function PasswordStep({
  busy,
  email,
  onPasswordChange,
  onStartOver,
  onSubmit,
  password,
}: {
  readonly busy: boolean;
  readonly email: string;
  readonly onPasswordChange: (value: string) => void;
  readonly onStartOver: () => void;
  readonly onSubmit: () => void;
  readonly password: string;
}) {
  return (
    <View style={styles.step}>
      <StepHeader caption={email} title="Welcome back" />
      <View style={styles.form}>
        <Field>
          <FieldLabel>Password</FieldLabel>
          <Input
            accessibilityLabel="Password"
            autoComplete="current-password"
            autoFocus
            editable={!busy}
            onChangeText={onPasswordChange}
            onSubmitEditing={onSubmit}
            returnKeyType="done"
            secureTextEntry
            textContentType="password"
            value={password}
          />
        </Field>
        <Button isDisabled={busy || password.length === 0} loading={busy} onPress={onSubmit}>
          <ButtonText>Sign in</ButtonText>
        </Button>
        <QuietActions>
          <QuietAction isDisabled={busy} label="Use a different email" onPress={onStartOver} />
        </QuietActions>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12 },
  step: { gap: 24 },
});
