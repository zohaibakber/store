import { useSignIn, useSignUp } from "@clerk/expo";
import { useSSO } from "@clerk/expo/experimental";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";

import {
  clerkErrorMessage,
  clerkFieldMessage,
  clerkGlobalMessages,
  isIdentifierNotFound,
} from "@/lib/clerk-errors";

WebBrowser.maybeCompleteAuthSession();

const goHome = (router: ReturnType<typeof useRouter>) => ({
  session,
}: {
  session?: { currentTask?: unknown } | null;
}) => {
  if (session?.currentTask) return;
  router.replace("/home");
};

export function useClerkAuthFlow() {
  const router = useRouter();
  const { startSSOFlow } = useSSO();
  const { signIn, errors: signInErrors, fetchStatus: signInStatus } = useSignIn();
  const { signUp, errors: signUpErrors, fetchStatus: signUpStatus } = useSignUp();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [googleBusy, setGoogleBusy] = useState(false);
  const [localError, setLocalError] = useState<string | undefined>();

  useEffect(() => {
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);

  const verifyingSignUp =
    signUp.status === "missing_requirements" &&
    signUp.unverifiedFields.includes("email_address") &&
    signUp.missingFields.length === 0;
  const verifyingSignIn =
    signIn.status === "needs_first_factor" ||
    signIn.status === "needs_second_factor" ||
    signIn.status === "needs_client_trust";
  const step = verifyingSignUp || verifyingSignIn ? "code" : "identifier";
  const busy = googleBusy || signInStatus === "fetching" || signUpStatus === "fetching";
  const fieldError =
    step === "code"
      ? clerkFieldMessage(verifyingSignUp ? signUpErrors.fields : signInErrors.fields, "code")
      : clerkFieldMessage(signInErrors.fields, "email") ??
        clerkFieldMessage(signUpErrors.fields, "email");
  const errorMessage =
    localError ??
    fieldError ??
    clerkGlobalMessages(verifyingSignUp ? signUpErrors.global : signInErrors.global)[0];

  const sendEmailCode = async () => {
    setLocalError(undefined);
    const emailAddress = email.trim();
    const { error } = await signIn.emailCode.sendCode({ emailAddress });
    if (!error) return;
    if (!isIdentifierNotFound(error) && !signIn.isTransferable) {
      setLocalError(clerkErrorMessage(error));
      return;
    }
    const { error: signUpError } = await signUp.create({
      emailAddress,
      transfer: signIn.isTransferable,
    });
    if (signUpError) {
      setLocalError(clerkErrorMessage(signUpError));
      return;
    }
    await signUp.verifications.sendEmailCode();
  };

  const verifyCode = async () => {
    setLocalError(undefined);
    if (verifyingSignUp) {
      await signUp.verifications.verifyEmailCode({ code });
    } else {
      await signIn.emailCode.verifyCode({ code });
    }
    if (signUp.status === "complete") {
      await signUp.finalize({ navigate: goHome(router) });
      return;
    }
    if (signIn.status === "complete") {
      await signIn.finalize({ navigate: goHome(router) });
      return;
    }
    if (signIn.status === "needs_second_factor" || signIn.status === "needs_client_trust") {
      const emailFactor = signIn.supportedSecondFactors?.find(
        (factor) => factor.strategy === "email_code",
      );
      if (emailFactor) await signIn.mfa.sendEmailCode();
    }
  };

  const resendCode = async () => {
    setLocalError(undefined);
    if (verifyingSignUp) {
      await signUp.verifications.sendEmailCode();
      return;
    }
    if (signIn.status === "needs_second_factor" || signIn.status === "needs_client_trust") {
      await signIn.mfa.sendEmailCode();
      return;
    }
    await signIn.emailCode.sendCode();
  };

  const startOver = async () => {
    setCode("");
    setLocalError(undefined);
    await signIn.reset();
    await signUp.reset();
  };

  const startGoogle = async () => {
    setLocalError(undefined);
    setGoogleBusy(true);
    try {
      const { createdSessionId, signUp: googleSignUp } = await startSSOFlow({
        strategy: "oauth_google",
      });
      if (createdSessionId) return;
      if (googleSignUp?.status === "missing_requirements") {
        setLocalError("Google sign-in needs another step. Try email instead.");
      }
    } catch (cause) {
      setLocalError(clerkErrorMessage(cause as { message?: string }) ?? "Google sign-in failed.");
    } finally {
      setGoogleBusy(false);
    }
  };

  return {
    busy,
    code,
    email,
    errorMessage,
    sendEmailCode,
    setCode,
    setEmail,
    startGoogle,
    startOver,
    step,
    resendCode,
    verifyCode,
  };
}
