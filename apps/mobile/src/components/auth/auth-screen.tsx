import type { LoginRoute } from "@store/auth";
import { Redirect } from "expo-router";
import { StyleSheet, View } from "react-native";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";

import { AuthShell, ErrorLine } from "@/components/auth/auth-shell";
import { IdentifierStep } from "@/components/auth/identifier-step";
import { OtpStep } from "@/components/auth/otp-step";
import { PasswordStep } from "@/components/auth/password-step";
import { RegistrationStep } from "@/components/auth/registration-step";
import { LoadingScreen } from "@/components/loading-screen";
import { useAuthFlow } from "@/hooks/use-auth-flow";
import { useMobileAuth } from "@/lib/auth-provider";
import { hapticSelection } from "@/lib/haptics";
import { useColors } from "@/theme/colors";
import { motion } from "@/theme/tokens";

const STEP_IN = FadeInDown.duration(motion.enterMs).reduceMotion(ReduceMotion.System);

const stepKey = (route: LoginRoute | null) => route?._tag ?? "Identifier";

export function AuthScreen() {
  const { state } = useMobileAuth();
  const colors = useColors();
  const {
    busy,
    code,
    continueWithEmail,
    email,
    errorMessage,
    name,
    password,
    resendCode,
    route,
    setCode,
    setEmail,
    setName,
    setPassword,
    startGoogle,
    startOver,
    submit,
  } = useAuthFlow();

  if (state._tag === "Loading") return <LoadingScreen />;
  if (state._tag === "Authenticated") return <Redirect href="/home" />;

  const continueWithGoogle = () => {
    hapticSelection();
    void startGoogle();
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <AuthShell>
        {errorMessage ? <ErrorLine message={errorMessage} /> : null}
        <Animated.View entering={STEP_IN} key={stepKey(route)}>
          <AuthStep
            busy={busy}
            code={code}
            continueWithEmail={continueWithEmail}
            email={email}
            name={name}
            onGoogle={continueWithGoogle}
            password={password}
            resendCode={resendCode}
            route={route}
            setCode={setCode}
            setEmail={setEmail}
            setName={setName}
            setPassword={setPassword}
            startOver={startOver}
            submit={submit}
          />
        </Animated.View>
      </AuthShell>
    </View>
  );
}

function AuthStep({
  busy,
  code,
  continueWithEmail,
  email,
  name,
  onGoogle,
  password,
  resendCode,
  route,
  setCode,
  setEmail,
  setName,
  setPassword,
  startOver,
  submit,
}: {
  readonly busy: boolean;
  readonly code: string;
  readonly continueWithEmail: () => void;
  readonly email: string;
  readonly name: string;
  readonly onGoogle: () => void;
  readonly password: string;
  readonly resendCode: () => void;
  readonly route: LoginRoute | null;
  readonly setCode: (value: string) => void;
  readonly setEmail: (value: string) => void;
  readonly setName: (value: string) => void;
  readonly setPassword: (value: string) => void;
  readonly startOver: () => void;
  readonly submit: () => void;
}) {
  if (!route) {
    return (
      <IdentifierStep
        busy={busy}
        email={email}
        onContinue={continueWithEmail}
        onEmailChange={setEmail}
        onGoogle={onGoogle}
      />
    );
  }

  switch (route._tag) {
    case "Password":
      return (
        <PasswordStep
          busy={busy}
          email={route.email}
          onPasswordChange={setPassword}
          onStartOver={startOver}
          onSubmit={submit}
          password={password}
        />
      );
    case "Otp":
      return (
        <OtpStep
          busy={busy}
          code={code}
          developmentCode={route.developmentCode}
          email={route.email}
          onCodeChange={setCode}
          onResend={resendCode}
          onStartOver={startOver}
          onSubmit={submit}
        />
      );
    case "Registration":
      return (
        <RegistrationStep
          busy={busy}
          email={route.email}
          name={name}
          onNameChange={setName}
          onPasswordChange={setPassword}
          onStartOver={startOver}
          onSubmit={submit}
          password={password}
        />
      );
    default: {
      const _exhaustive: never = route;
      return _exhaustive;
    }
  }
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
