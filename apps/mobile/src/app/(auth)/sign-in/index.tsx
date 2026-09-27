import { useNativeState } from "@expo/ui";
import { useRouter, type Href } from "expo-router";
import * as React from "react";
import { View } from "react-native";

import { useAuthActions, useSession, type AuthProblem, type IdentifyResult } from "@/auth";
import { ActionButton } from "@/auth/ui/action-button";
import { Attention, AuthScreen, ProblemMessage, fieldError } from "@/auth/ui/auth-screen";
import { Field } from "@/auth/ui/field";
import { colors, space } from "@/theme/tokens";
import { Text } from "@/ui/text";

const nextStep = {
  Otp: "/sign-in/code",
  Password: "/sign-in/password",
  Registration: "/sign-in/create-account",
} satisfies Record<Extract<IdentifyResult, { _tag: "Routed" }>["route"], Href>;

function Divider() {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.hairline }} />
      <Text size="xs" tone="muted">
        or
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.hairline }} />
    </View>
  );
}

export default function SignInScreen() {
  const session = useSession();
  const { identify, signInWithGoogle, googleAvailable } = useAuthActions();
  const { push } = useRouter();
  const emailState = useNativeState("");
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState<"email" | "google" | null>(null);
  const [problem, setProblem] = React.useState<AuthProblem | null>(null);
  const notice = session.status === "signedOut" ? session.notice : undefined;

  const continueWithEmail = async (value: string) => {
    if (busy !== null || value.trim().length === 0) return;
    setBusy("email");
    setProblem(null);
    const result = await identify(value);
    setBusy(null);
    if (result._tag === "Failed") {
      setProblem(result.problem);
      return;
    }
    push(nextStep[result.route]);
  };

  const continueWithGoogle = async () => {
    if (busy !== null) return;
    setBusy("google");
    setProblem(null);
    const result = await signInWithGoogle();
    setBusy(null);
    if (result._tag === "Failed") setProblem(result.problem);
  };

  return (
    <AuthScreen title="Sign in to Tabaaq" description="Use the email you work with.">
      {notice === undefined ? null : <Attention>{notice}</Attention>}
      <Field
        label="Email"
        state={emailState}
        onChangeText={(text) => {
          setEmail(text);
          setProblem(null);
        }}
        error={fieldError(problem, "email")}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        returnKeyType="go"
        onSubmitEditing={(text) => void continueWithEmail(text)}
        editable={busy === null}
      />
      <ProblemMessage problem={problem} />
      <ActionButton
        label="Continue"
        loading={busy === "email"}
        disabled={busy === "google" || email.trim().length === 0}
        onPress={() => void continueWithEmail(email)}
      />
      {googleAvailable ? (
        <>
          <Divider />
          <ActionButton
            label="Continue with Google"
            variant="secondary"
            loading={busy === "google"}
            disabled={busy === "email"}
            onPress={() => void continueWithGoogle()}
          />
        </>
      ) : null}
    </AuthScreen>
  );
}
