import type { LoginRoute } from "@store/auth";
import { Redirect, router } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Brand } from "@/components/brand";
import { LoadingScreen } from "@/components/loading-screen";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TextField } from "@/components/ui/text-field";
import { useAuthFlow } from "@/hooks/use-auth-flow";
import { useThemeColor } from "@/hooks/use-theme-color";
import { useMobileAuth } from "@/lib/auth-provider";

interface StepProps {
  readonly busy: boolean;
  readonly route: LoginRoute;
  readonly submit: () => void;
  readonly startOver: () => void;
}

function IdentifierStep({
  busy,
  email,
  onEmailChange,
  onContinue,
  onGoogle,
}: {
  readonly busy: boolean;
  readonly email: string;
  readonly onEmailChange: (value: string) => void;
  readonly onContinue: () => void;
  readonly onGoogle: () => void;
}) {
  return (
    <View style={styles.form}>
      <TextField>
        <Text style={styles.label}>Email</Text>
        <Input
          accessibilityLabel="Email"
          autoCapitalize="none"
          editable={!busy}
          keyboardType="email-address"
          onChangeText={onEmailChange}
          placeholder="you@example.com"
          returnKeyType="next"
          value={email}
        />
      </TextField>
      <Button isDisabled={busy} onPress={onContinue}>
        Continue
      </Button>
      <Button isDisabled={busy} onPress={onGoogle} variant="outline">
        Continue with Google
      </Button>
    </View>
  );
}

function PasswordStep({
  busy,
  password,
  route,
  setPassword,
  startOver,
  submit,
}: StepProps & {
  readonly password: string;
  readonly route: Extract<LoginRoute, { readonly _tag: "Password" }>;
  readonly setPassword: (value: string) => void;
}) {
  return (
    <View style={styles.form}>
      <Text style={styles.routeEmail}>{route.email}</Text>
      <TextField>
        <Text style={styles.label}>Password</Text>
        <Input
          accessibilityLabel="Password"
          editable={!busy}
          onChangeText={setPassword}
          returnKeyType="done"
          secureTextEntry
          value={password}
        />
      </TextField>
      <Button isDisabled={busy} onPress={submit}>
        Sign in
      </Button>
      <Button isDisabled={busy} onPress={startOver} variant="ghost">
        Use another email
      </Button>
    </View>
  );
}

function OtpStep({
  busy,
  code,
  developmentCode,
  resendCode,
  route,
  setCode,
  startOver,
  submit,
}: StepProps & {
  readonly code: string;
  readonly developmentCode?: string;
  readonly resendCode: () => void;
  readonly route: Extract<LoginRoute, { readonly _tag: "Otp" }>;
  readonly setCode: (value: string) => void;
}) {
  return (
    <View style={styles.form}>
      <Text style={styles.routeEmail}>{route.email}</Text>
      <TextField>
        <Text style={styles.label}>One-time code</Text>
        <Input
          accessibilityLabel="One-time code"
          editable={!busy}
          keyboardType="number-pad"
          maxLength={6}
          onChangeText={setCode}
          returnKeyType="done"
          value={code}
        />
      </TextField>
      {developmentCode ? (
        <Alert status="success">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Development code</Alert.Title>
            <Alert.Description>{developmentCode}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      <Button isDisabled={busy} onPress={submit}>
        Verify code
      </Button>
      <Button isDisabled={busy} onPress={resendCode} variant="outline">
        Get a new code
      </Button>
      <Button isDisabled={busy} onPress={startOver} variant="ghost">
        Use another email
      </Button>
    </View>
  );
}

function RegistrationStep({
  busy,
  name,
  password,
  route,
  setName,
  setPassword,
  startOver,
  submit,
}: StepProps & {
  readonly name: string;
  readonly password: string;
  readonly route: Extract<LoginRoute, { readonly _tag: "Registration" }>;
  readonly setName: (value: string) => void;
  readonly setPassword: (value: string) => void;
}) {
  return (
    <View style={styles.form}>
      <Text style={styles.routeEmail}>{route.email}</Text>
      <TextField>
        <Text style={styles.label}>Name</Text>
        <Input
          accessibilityLabel="Name"
          editable={!busy}
          onChangeText={setName}
          returnKeyType="next"
          value={name}
        />
      </TextField>
      <TextField>
        <Text style={styles.label}>Password</Text>
        <Input
          accessibilityLabel="Password"
          editable={!busy}
          onChangeText={setPassword}
          returnKeyType="done"
          secureTextEntry
          value={password}
        />
        <Text style={styles.hint}>Use at least 10 characters.</Text>
      </TextField>
      <Button isDisabled={busy} onPress={submit}>
        Create account
      </Button>
      <Button isDisabled={busy} onPress={startOver} variant="ghost">
        Use another email
      </Button>
    </View>
  );
}

export function AuthScreen() {
  const { state } = useMobileAuth();
  const background = useThemeColor("background");
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");
  const flow = useAuthFlow();

  if (state._tag === "Loading") return <LoadingScreen />;
  if (state._tag === "Authenticated") return <Redirect href="/home" />;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: background }}
    >
      <Brand />
      <View style={styles.heading}>
        <Text style={[styles.title, { color: foreground }]}>
          {flow.route?._tag === "Registration" ? "Create your account" : "Sign in to sync"}
        </Text>
        <Text style={[styles.description, { color: muted }]}>
          Sign-in is optional. Local inventory remains on this device until you connect an account.
        </Text>
      </View>
      {flow.errorMessage ? (
        <Alert>
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Could not continue</Alert.Title>
            <Alert.Description>{flow.errorMessage}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      {!flow.route ? (
        <IdentifierStep
          busy={flow.busy}
          email={flow.email}
          onContinue={() => void flow.continueWithEmail()}
          onEmailChange={flow.setEmail}
          onGoogle={() => void flow.startGoogle()}
        />
      ) : flow.route._tag === "Password" ? (
        <PasswordStep
          busy={flow.busy}
          password={flow.password}
          route={flow.route}
          setPassword={flow.setPassword}
          startOver={flow.startOver}
          submit={() => void flow.submit()}
        />
      ) : flow.route._tag === "Otp" ? (
        <OtpStep
          busy={flow.busy}
          code={flow.code}
          developmentCode={flow.developmentCode}
          resendCode={() => void flow.resendCode()}
          route={flow.route}
          setCode={flow.setCode}
          startOver={flow.startOver}
          submit={() => void flow.submit()}
        />
      ) : (
        <RegistrationStep
          busy={flow.busy}
          name={flow.name}
          password={flow.password}
          route={flow.route}
          setName={flow.setName}
          setPassword={flow.setPassword}
          startOver={flow.startOver}
          submit={() => void flow.submit()}
        />
      )}
      <Button onPress={() => router.replace("/home")} variant="ghost">
        Continue without an account
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    alignSelf: "center",
    flexGrow: 1,
    gap: 24,
    justifyContent: "center",
    maxWidth: 440,
    padding: 24,
    width: "100%",
  },
  description: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
  form: { gap: 14 },
  heading: { gap: 8 },
  hint: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  label: { fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20 },
  routeEmail: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
  title: { fontFamily: "Inter_500Medium", fontSize: 24, lineHeight: 30 },
});
