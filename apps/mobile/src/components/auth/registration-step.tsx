import { StyleSheet, View } from "react-native";

import { StepHeader } from "@/components/auth/auth-shell";
import { QuietAction, QuietActions } from "@/components/auth/quiet-action";
import { Button, ButtonText } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const MIN_PASSWORD = 10;

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
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;

  return (
    <View style={styles.step}>
      <StepHeader caption={email} title="Create your account" />
      <View style={styles.form}>
        <Field>
          <FieldLabel>Name</FieldLabel>
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
        </Field>
        <Field>
          <FieldLabel>Password</FieldLabel>
          <Input
            accessibilityLabel="Password"
            autoComplete="new-password"
            editable={!busy}
            invalid={tooShort}
            onChangeText={onPasswordChange}
            onSubmitEditing={onSubmit}
            returnKeyType="done"
            secureTextEntry
            textContentType="newPassword"
            value={password}
          />
          <FieldDescription>{`At least ${MIN_PASSWORD} characters.`}</FieldDescription>
        </Field>
        <Button
          isDisabled={busy || name.trim().length === 0 || password.length < MIN_PASSWORD}
          loading={busy}
          onPress={onSubmit}
        >
          <ButtonText>Create account</ButtonText>
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
