import { StyleSheet, View } from "react-native";

import { StepHeader } from "@/components/auth/auth-shell";
import { QuietAction, QuietActions } from "@/components/auth/quiet-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TextField } from "@/components/ui/text-field";

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
        <TextField>
          <Label>Password</Label>
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
        </TextField>
        <Button isDisabled={busy || password.length === 0} onPress={onSubmit}>
          {busy ? "Signing in…" : "Sign in"}
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
