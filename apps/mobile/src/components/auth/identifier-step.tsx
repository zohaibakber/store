import { StyleSheet, View } from "react-native";

import { StepHeader } from "@/components/auth/auth-shell";
import { GoogleAction } from "@/components/auth/google-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TextField } from "@/components/ui/text-field";
import { isGoogleSignInConfigured } from "@/lib/google-signin";

export function IdentifierStep({
  busy,
  email,
  onContinue,
  onEmailChange,
  onGoogle,
}: {
  readonly busy: boolean;
  readonly email: string;
  readonly onContinue: () => void;
  readonly onEmailChange: (value: string) => void;
  readonly onGoogle: () => void;
}) {
  return (
    <View style={styles.step}>
      <StepHeader caption="An account is required to use Tabaaq on this device." title="Sign in" />
      <View style={styles.form}>
        <TextField>
          <Label>Email</Label>
          <Input
            accessibilityLabel="Email"
            autoCapitalize="none"
            autoComplete="email"
            autoFocus
            editable={!busy}
            keyboardType="email-address"
            onChangeText={onEmailChange}
            onSubmitEditing={onContinue}
            placeholder="you@example.com"
            returnKeyType="next"
            textContentType="emailAddress"
            value={email}
          />
        </TextField>
        <Button isDisabled={busy || email.trim().length === 0} onPress={onContinue}>
          {busy ? "Checking…" : "Continue"}
        </Button>
        {isGoogleSignInConfigured ? <GoogleAction isDisabled={busy} onPress={onGoogle} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12 },
  step: { gap: 24 },
});
