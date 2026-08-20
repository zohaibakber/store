import { StyleSheet, View } from "react-native";

import { Footnote, StepHeader } from "@/components/auth/auth-shell";
import { QuietAction, QuietActions } from "@/components/auth/quiet-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TextField } from "@/components/ui/text-field";

export function RegistrationStep({
  busy,
  email,
  name,
  onNameChange,
  onPasswordChange,
  onStartOver,
  onSubmit,
  password,
}: {
  readonly busy: boolean;
  readonly email: string;
  readonly name: string;
  readonly onNameChange: (value: string) => void;
  readonly onPasswordChange: (value: string) => void;
  readonly onStartOver: () => void;
  readonly onSubmit: () => void;
  readonly password: string;
}) {
  return (
    <View style={styles.step}>
      <StepHeader caption={email} title="Create your account" />
      <View style={styles.form}>
        <TextField>
          <Label>Name</Label>
          <Input
            accessibilityLabel="Name"
            autoComplete="name"
            autoFocus
            editable={!busy}
            onChangeText={onNameChange}
            returnKeyType="next"
            textContentType="name"
            value={name}
          />
        </TextField>
        <TextField>
          <Label>Password</Label>
          <Input
            accessibilityLabel="Password"
            autoComplete="new-password"
            editable={!busy}
            onChangeText={onPasswordChange}
            onSubmitEditing={onSubmit}
            returnKeyType="done"
            secureTextEntry
            textContentType="newPassword"
            value={password}
          />
        </TextField>
        <Footnote>At least 10 characters.</Footnote>
        <Button
          isDisabled={busy || name.trim().length === 0 || password.length < 10}
          onPress={onSubmit}
        >
          {busy ? "Creating…" : "Create account"}
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
