import { useNativeState, type TextInputRef } from "@expo/ui";
import { Redirect, useRouter } from "expo-router";
import * as React from "react";
import { View } from "react-native";

import { useAuthActions, useSignInFlow, type AuthProblem } from "@/auth";
import { ActionButton } from "@/auth/ui/action-button";
import { AuthScreen, ProblemMessage, fieldError } from "@/auth/ui/auth-screen";
import { Field } from "@/auth/ui/field";
import { space } from "@/theme/tokens";
import { Text } from "@/ui/text";

const CODE_LENGTH = 6;

type CodeFormProps = {
  readonly email: string;
  readonly developmentCode: string | undefined;
};

function CodeForm({ email, developmentCode }: CodeFormProps) {
  const { verifyCode, resendCode } = useAuthActions();
  const { back } = useRouter();
  const codeState = useNativeState("");
  const codeInput = React.useRef<TextInputRef>(null);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState<"verify" | "resend" | null>(null);
  const [problem, setProblem] = React.useState<AuthProblem | null>(null);
  const [resent, setResent] = React.useState(false);

  const verify = async (value: string) => {
    if (busy !== null || value.length !== CODE_LENGTH) return;
    setBusy("verify");
    setProblem(null);
    const result = await verifyCode(value);
    setBusy(null);
    if (result._tag === "Failed") setProblem(result.problem);
  };

  const resend = async () => {
    if (busy !== null) return;
    setBusy("resend");
    setProblem(null);
    setResent(false);
    const result = await resendCode();
    setBusy(null);
    if (result._tag === "Failed") {
      setProblem(result.problem);
      return;
    }
    codeInput.current?.clear();
    setCode("");
    setResent(true);
  };

  return (
    <AuthScreen
      title="Check your email"
      description={`Enter the 6-digit code we sent to ${email}.`}
      footer={
        <ActionButton
          label="Use another email"
          variant="quiet"
          disabled={busy !== null}
          onPress={back}
        />
      }
    >
      {developmentCode === undefined ? null : (
        <Text tone="muted">
          Development code: <Text mono>{developmentCode}</Text>
        </Text>
      )}
      <Field
        label="Code"
        state={codeState}
        inputRef={codeInput}
        onChangeText={(text) => {
          const digits = text.replace(/\D/gu, "").slice(0, CODE_LENGTH);
          setCode(digits);
          setProblem(null);
          setResent(false);
          if (digits.length === CODE_LENGTH) void verify(digits);
        }}
        error={fieldError(problem, "code")}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        maxLength={CODE_LENGTH}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={(text) => void verify(text.replace(/\D/gu, "").slice(0, CODE_LENGTH))}
        editable={busy === null}
      />
      <ProblemMessage problem={problem} />
      <View style={{ gap: space[2] }}>
        <ActionButton
          label="Verify"
          loading={busy === "verify"}
          disabled={busy === "resend" || code.length !== CODE_LENGTH}
          onPress={() => void verify(code)}
        />
        <View style={{ alignItems: "center" }}>
          <ActionButton
            label={resent ? "New code sent" : "Send a new code"}
            variant="quiet"
            loading={busy === "resend"}
            disabled={busy === "verify" || resent}
            onPress={() => void resend()}
          />
        </View>
      </View>
    </AuthScreen>
  );
}

export default function CodeScreen() {
  const flow = useSignInFlow();
  const route = flow?.route;
  if (route?._tag !== "Otp") return <Redirect href="/sign-in" />;
  return <CodeForm email={route.email} developmentCode={route.developmentCode} />;
}
