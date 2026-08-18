import { useAuth } from "@clerk/expo";
import { Host } from "@expo/ui";
import {
  Button,
  Column,
  OutlinedButton,
  OutlinedTextField,
  Surface,
  Text,
  TextButton,
  useMaterialColors,
} from "@expo/ui/jetpack-compose";
import { fillMaxSize, fillMaxWidth, padding } from "@expo/ui/jetpack-compose/modifiers";
import { Redirect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LoadingScreen } from "@/components/loading-screen";
import { ErrorBanner } from "@/components/material-list.android";
import { useClerkAuthFlow } from "@/hooks/use-clerk-auth-flow";
import { useLastUserId } from "@/lib/local-session";
import { useAppColorScheme } from "@/theme/appearance";

function ClerkAuthForm() {
  const scheme = useAppColorScheme();
  const colors = useMaterialColors({ colorScheme: scheme });
  const insets = useSafeAreaInsets();
  const {
    busy,
    errorMessage,
    resendCode,
    sendEmailCode,
    setCode,
    setEmail,
    startGoogle,
    startOver,
    step,
    verifyCode,
  } = useClerkAuthFlow();

  return (
    <Host colorScheme={scheme} style={{ flex: 1 }}>
      <Surface color={colors.surface} modifiers={[fillMaxSize()]}>
        <Column
          modifiers={[
            fillMaxSize(),
            padding(24, insets.top + 24, 24, insets.bottom + 24),
          ]}
          verticalArrangement={{ spacedBy: 16 }}
        >
          <Text color={colors.onSurface} style={{ typography: "headlineSmall" }}>
            {step === "code" ? "Check your email" : "Sign in to Tabaaq"}
          </Text>
          <Text color={colors.onSurfaceVariant} style={{ typography: "bodyMedium" }}>
            {step === "code"
              ? "Enter the 6-digit code we sent you."
              : "Continue with Google or an email code."}
          </Text>
          {errorMessage ? (
            <ErrorBanner
              message={errorMessage}
              onRetry={() => void (step === "code" ? startOver() : sendEmailCode())}
              title="Could not continue"
            />
          ) : null}
          {step === "identifier" ? (
            <OutlinedTextField
              enabled={!busy}
              keyboardOptions={{
                autoCorrectEnabled: false,
                capitalization: "none",
                imeAction: "done",
                keyboardType: "email",
              }}
              keyboardActions={{ onDone: () => void sendEmailCode() }}
              modifiers={[fillMaxWidth()]}
              onValueChange={setEmail}
              singleLine
            >
              <OutlinedTextField.Label>
                <Text>Email</Text>
              </OutlinedTextField.Label>
            </OutlinedTextField>
          ) : (
            <OutlinedTextField
              enabled={!busy}
              keyboardOptions={{ imeAction: "done", keyboardType: "number" }}
              keyboardActions={{ onDone: () => void verifyCode() }}
              maxLength={6}
              modifiers={[fillMaxWidth()]}
              onValueChange={setCode}
              singleLine
            >
              <OutlinedTextField.Label>
                <Text>Verification code</Text>
              </OutlinedTextField.Label>
            </OutlinedTextField>
          )}
          {step === "identifier" ? (
            <Button enabled={!busy} modifiers={[fillMaxWidth()]} onClick={() => void sendEmailCode()}>
              <Text>Continue</Text>
            </Button>
          ) : (
            <Button enabled={!busy} modifiers={[fillMaxWidth()]} onClick={() => void verifyCode()}>
              <Text>Verify</Text>
            </Button>
          )}
          {step === "identifier" ? (
            <OutlinedButton
              enabled={!busy}
              modifiers={[fillMaxWidth()]}
              onClick={() => void startGoogle()}
            >
              <Text>Continue with Google</Text>
            </OutlinedButton>
          ) : (
            <Column modifiers={[fillMaxWidth()]} verticalArrangement={{ spacedBy: 4 }}>
              <TextButton enabled={!busy} onClick={() => void resendCode()}>
                <Text>I need a new code</Text>
              </TextButton>
              <TextButton enabled={!busy} onClick={() => void startOver()}>
                <Text>Start over</Text>
              </TextButton>
            </Column>
          )}
        </Column>
      </Surface>
    </Host>
  );
}

export function AuthScreen() {
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const lastUserId = useLastUserId();

  if (isSignedIn) return <Redirect href="/home" />;
  if (!isLoaded && lastUserId) return <Redirect href="/home" />;
  if (!isLoaded) return <LoadingScreen />;
  return <ClerkAuthForm />;
}
