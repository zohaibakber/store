import { useNativeState, type TextInputRef } from "@expo/ui";
import { Redirect, useRouter } from "expo-router";
import * as React from "react";

import { useAuthActions, useSignInFlow, type AuthProblem } from "@/auth";
import { ActionButton } from "@/auth/ui/action-button";
import { AuthScreen, ProblemMessage, fieldError } from "@/auth/ui/auth-screen";
import { Field } from "@/auth/ui/field";

function CreateAccountForm({ email }: { readonly email: string }) {
  const { createAccount } = useAuthActions();
  const { back } = useRouter();
  const nameState = useNativeState("");
  const passwordState = useNativeState("");
  const passwordInput = React.useRef<TextInputRef>(null);
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<AuthProblem | null>(null);

  const submit = async (passwordText: string) => {
    if (busy || name.trim().length === 0 || passwordText.length === 0) return;
    setBusy(true);
    setProblem(null);
    const result = await createAccount({ name, password: passwordText });
    setBusy(false);
    if (result._tag === "Failed") setProblem(result.problem);
  };

  return (
    <AuthScreen
      title="Create your account"
      description={`No account uses ${email} yet.`}
      footer={
        <ActionButton label="Use another email" variant="quiet" disabled={busy} onPress={back} />
      }
    >
      <Field
        label="Your name"
        state={nameState}
        onChangeText={(text) => {
          setName(text);
          setProblem(null);
        }}
        error={fieldError(problem, "name")}
        autoCapitalize="words"
        autoComplete="name"
        autoFocus
        returnKeyType="next"
        onSubmitEditing={() => passwordInput.current?.focus()}
        editable={!busy}
      />
      <Field
        label="Password"
        state={passwordState}
        inputRef={passwordInput}
        onChangeText={(text) => {
          setPassword(text);
          setProblem(null);
        }}
        error={fieldError(problem, "password")}
        hint="Use 10 to 100 characters."
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        returnKeyType="go"
        onSubmitEditing={(text) => void submit(text)}
        editable={!busy}
      />
      <ProblemMessage problem={problem} />
      <ActionButton
        label="Create account"
        loading={busy}
        disabled={name.trim().length === 0 || password.length === 0}
        onPress={() => void submit(password)}
      />
    </AuthScreen>
  );
}

export default function CreateAccountScreen() {
  const route = useSignInFlow()?.route;
  if (route?._tag !== "Registration") return <Redirect href="/sign-in" />;
  return <CreateAccountForm email={route.email} />;
}
