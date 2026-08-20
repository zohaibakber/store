import { StyleSheet, View } from "react-native";

import { StepHeader } from "@/components/auth/auth-shell";
import { GoogleAction } from "@/components/auth/google-action";
import { Button, ButtonText } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
        <Field>
          <FieldLabel>Email</FieldLabel>
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
        </Field>
        <Button isDisabled={busy || email.trim().length === 0} loading={busy} onPress={onContinue}>
          <ButtonText>Continue</ButtonText>
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
