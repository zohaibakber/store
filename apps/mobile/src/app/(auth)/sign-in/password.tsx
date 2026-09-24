import { useNativeState } from "@expo/ui";
import { Redirect, useRouter } from "expo-router";
import * as React from "react";

import { useAuthActions, useSignInFlow, type AuthProblem } from "@/auth";
import { ActionButton } from "@/auth/ui/action-button";
import { AuthScreen, ProblemMessage, fieldError } from "@/auth/ui/auth-screen";
import { Field } from "@/auth/ui/field";

function PasswordForm({ email }: { readonly email: string }) {
  const { signInWithPassword } = useAuthActions();
  const { back } = useRouter();
  const passwordState = useNativeState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<AuthProblem | null>(null);

  const submit = async (value: string) => {
    if (busy || value.length === 0) return;
    setBusy(true);
    setProblem(null);
    const result = await signInWithPassword(value);
    setBusy(false);
    if (result._tag === "Failed") setProblem(result.problem);
  };

  return (
    <AuthScreen
      title="Enter your password"
      description={`Signing in as ${email}.`}
      footer={
        <ActionButton label="Use another email" variant="quiet" disabled={busy} onPress={back} />
      }
    >
      <Field
        label="Password"
        state={passwordState}
        onChangeText={(text) => {
          setPassword(text);
          setProblem(null);
        }}
        error={fieldError(problem, "password")}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        autoFocus
        returnKeyType="go"
        onSubmitEditing={(text) => void submit(text)}
        editable={!busy}
      />
      <ProblemMessage problem={problem} />
      <ActionButton
        label="Sign in"
        loading={busy}
        disabled={password.length === 0}
        onPress={() => void submit(password)}
      />
    </AuthScreen>
  );
}

export default function PasswordScreen() {
  const route = useSignInFlow()?.route;
  if (route?._tag !== "Password") return <Redirect href="/sign-in" />;
  return <PasswordForm email={route.email} />;
}
