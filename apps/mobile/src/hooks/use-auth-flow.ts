import { OtpCode, Password, type LoginRoute } from "@store/auth";
import { useState } from "react";

import {
  authErrorMessage,
  authenticateMobile,
  identifyMobile,
  isOfflineCause,
} from "@/lib/auth-client";
import { useMobileAuth } from "@/lib/auth-provider";
import { hapticError } from "@/lib/haptics";
import { reportError } from "@/lib/report-error";

const nativeClient = {
  _tag: "Native" as const,
  deviceName: __DEV__ ? "Tabaaq Dev Mobile" : "Tabaaq Mobile",
};

export function useAuthFlow() {
  const { actions } = useMobileAuth();
  const { completeAuthentication, signInWithGoogle } = actions;
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [route, setRoute] = useState<LoginRoute | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setErrorMessage(null);
    try {
      await operation();
    } catch (cause) {
      if (!isOfflineCause(cause)) {
        reportError(cause, { op: "mobile-sign-in" });
      }
      setErrorMessage(
        isOfflineCause(cause)
          ? "You're offline. Signing in needs a connection."
          : authErrorMessage(cause),
      );
      hapticError();
    } finally {
      setBusy(false);
    }
  };

  const continueWithEmail = () =>
    run(async () => {
      setRoute(await identifyMobile(email));
    });

  const submit = () =>
    run(async () => {
      if (!route) return;
      switch (route._tag) {
        case "Password":
          await authenticateMobile({
            _tag: "Password",
            email: route.email,
            password: Password.make(password),
            client: nativeClient,
          });
          break;
        case "Otp":
          await authenticateMobile({
            _tag: "Otp",
            challengeId: route.challengeId,
            code: OtpCode.make(code),
            client: nativeClient,
          });
          break;
        case "Registration":
          await authenticateMobile({
            _tag: "RegisterPassword",
            email: route.email,
            name,
            password: Password.make(password),
            client: nativeClient,
          });
          break;
        default: {
          const _exhaustive: never = route;
          return _exhaustive;
        }
      }
      await completeAuthentication();
    });

  const startGoogle = () => run(signInWithGoogle);

  const resendCode = () =>
    run(async () => {
      if (route?._tag !== "Otp") return;
      const next = await identifyMobile(route.email);
      setCode("");
      setRoute(next);
    });

  const startOver = () => {
    setRoute(null);
    setPassword("");
    setCode("");
    setErrorMessage(null);
  };

  return {
    busy,
    code,
    continueWithEmail,
    developmentCode: route?._tag === "Otp" ? route.developmentCode : undefined,
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
  };
}
