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
  const flow = useAuthFlow();

  if (state._tag === "Loading") return <LoadingScreen />;
  if (state._tag === "Authenticated") return <Redirect href="/home" />;

  const continueWithGoogle = () => {
    hapticSelection();
    void flow.startGoogle();
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <AuthShell>
        {flow.errorMessage ? <ErrorLine message={flow.errorMessage} /> : null}
        <Animated.View entering={STEP_IN} key={stepKey(flow.route)}>
          <AuthStep flow={flow} onGoogle={continueWithGoogle} />
        </Animated.View>
      </AuthShell>
    </View>
  );
}

function AuthStep({
  flow,
  onGoogle,
}: {
  readonly flow: ReturnType<typeof useAuthFlow>;
  readonly onGoogle: () => void;
}) {
  const route = flow.route;

  if (!route) {
    return (
      <IdentifierStep
        busy={flow.busy}
        email={flow.email}
        onContinue={() => void flow.continueWithEmail()}
        onEmailChange={flow.setEmail}
        onGoogle={onGoogle}
      />
    );
  }

  switch (route._tag) {
    case "Password":
      return (
        <PasswordStep
          busy={flow.busy}
          email={route.email}
          onPasswordChange={flow.setPassword}
          onStartOver={flow.startOver}
          onSubmit={() => void flow.submit()}
          password={flow.password}
        />
      );
    case "Otp":
      return (
        <OtpStep
          busy={flow.busy}
          code={flow.code}
          developmentCode={route.developmentCode}
          email={route.email}
          onCodeChange={flow.setCode}
          onResend={() => void flow.resendCode()}
          onStartOver={flow.startOver}
          onSubmit={() => void flow.submit()}
        />
      );
    case "Registration":
      return (
        <RegistrationStep
          busy={flow.busy}
          email={route.email}
          name={flow.name}
          onNameChange={flow.setName}
          onPasswordChange={flow.setPassword}
          onStartOver={flow.startOver}
          onSubmit={() => void flow.submit()}
          password={flow.password}
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
