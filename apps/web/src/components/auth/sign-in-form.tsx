import { useNavigate } from "@tanstack/react-router";
import * as React from "react";

import {
  AuthGlobalErrors,
  AuthHeading,
  AuthLink,
  AuthLinks,
  EmailField,
  formText,
  GoogleButton,
  OrSeparator,
  PasswordField,
  VerificationForm,
} from "@/components/auth/shared";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { clerkFormErrors, compactFormErrors } from "@/lib/clerk-errors";
import {
  finalizeIfComplete,
  googleSsoParams,
  hasEmailCodeFirstFactor,
  hasEmailCodeSecondFactor,
  hasPasswordFirstFactor,
  settleOAuth,
} from "@/lib/clerk-flow";
import { useClerk, useSignIn, useSignUp } from "@/lib/clerk-runtime";

const continueAfterFirstFactor = async (signIn: ReturnType<typeof useSignIn>["signIn"]) => {
  if (await finalizeIfComplete(signIn)) return;
  if (signIn.status !== "needs_client_trust" && signIn.status !== "needs_second_factor") return;
  if (hasEmailCodeSecondFactor(signIn.supportedSecondFactors)) await signIn.mfa.sendEmailCode();
};

export function SignInForm() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const { signUp } = useSignUp();
  const clerk = useClerk();
  const navigate = useNavigate();
  const [oauthBusy, setOauthBusy] = React.useState(false);
  const requestedEmailCode = React.useRef(false);
  const fetching = fetchStatus === "fetching";
  const busy = fetching || oauthBusy;
  const formErrors = compactFormErrors(clerkFormErrors(errors.fields));
  const identifier = signIn.identifier ?? "";
  const passwordAvailable = hasPasswordFirstFactor(signIn.supportedFirstFactors);
  const needsMfa =
    signIn.status === "needs_client_trust" || signIn.status === "needs_second_factor";
  const needsPassword = signIn.status === "needs_first_factor" && passwordAvailable;
  const needsEmailCode = signIn.status === "needs_first_factor" && !passwordAvailable;

  React.useEffect(() => {
    if (!needsEmailCode || requestedEmailCode.current) return;
    if (!hasEmailCodeFirstFactor(signIn.supportedFirstFactors)) return;
    requestedEmailCode.current = true;
    void signIn.emailCode.sendCode();
  }, [needsEmailCode, signIn]);

  const startGoogle = async () => {
    setOauthBusy(true);
    try {
      const { error } = await signIn.sso(googleSsoParams());
      if (error) return;
      const result = await settleOAuth({ clerk, signIn, signUp });
      if (result.kind === "continue" && result.path !== "/sign-in") {
        await navigate({ to: result.path });
      }
    } finally {
      setOauthBusy(false);
    }
  };

  const submitEmail = async (formData: FormData) => {
    const { error } = await signIn.create({ identifier: formText(formData, "email") });
    if (error) return;
    if (await finalizeIfComplete(signIn)) return;
    if (signIn.status !== "needs_first_factor") return;
    if (hasPasswordFirstFactor(signIn.supportedFirstFactors)) return;
    if (!hasEmailCodeFirstFactor(signIn.supportedFirstFactors)) return;
    requestedEmailCode.current = true;
    await signIn.emailCode.sendCode();
  };

  const submitPassword = async (formData: FormData) => {
    const { error } = await signIn.password({ password: formText(formData, "password") });
    if (error) return;
    await continueAfterFirstFactor(signIn);
  };

  const verifyEmailCode = async (code: string) => {
    const { error } = await signIn.emailCode.verifyCode({ code });
    if (error) return;
    await continueAfterFirstFactor(signIn);
  };

  const verifyMfa = async (code: string) => {
    const { error } = await signIn.mfa.verifyEmailCode({ code });
    if (error) return;
    await finalizeIfComplete(signIn);
  };

  if (needsMfa) {
    return (
      <VerificationForm
        description={`A verification code has been sent to ${identifier || "your email"}.`}
        disabled={busy}
        fields={errors.fields}
        global={errors.global}
        onResend={() => void signIn.mfa.sendEmailCode()}
        onReset={() => {
          requestedEmailCode.current = false;
          void signIn.reset();
        }}
        onSubmit={verifyMfa}
      />
    );
  }

  if (needsEmailCode) {
    return (
      <div className="flex flex-col gap-4">
        <VerificationForm
          description={`A verification code has been sent to ${identifier || "your email"}.`}
          disabled={busy}
          fields={errors.fields}
          global={errors.global}
          onResend={() => void signIn.emailCode.sendCode()}
          onReset={() => {
            requestedEmailCode.current = false;
            void signIn.reset();
          }}
          onSubmit={verifyEmailCode}
        />
        <OrSeparator />
        <GoogleButton
          disabled={busy}
          label="Continue with Google"
          loading={oauthBusy}
          onClick={() => void startGoogle()}
        />
      </div>
    );
  }

  if (needsPassword) {
    return (
      <Form
        className="flex flex-col gap-4"
        errors={formErrors}
        onSubmit={(event) => {
          event.preventDefault();
          void submitPassword(new FormData(event.currentTarget));
        }}
      >
        <AuthHeading description={identifier} title="Enter your password" />
        <AuthGlobalErrors global={errors.global} />
        <PasswordField autoComplete="current-password" autoFocus id="sign-in-password" />
        <Button loading={busy} type="submit">
          Sign in
        </Button>
        <GoogleButton
          disabled={busy}
          label="Continue with Google"
          loading={oauthBusy}
          onClick={() => void startGoogle()}
        />
        <AuthLinks>
          <AuthLink to="/forgot-password">Forgot password?</AuthLink>
          <Button
            disabled={busy}
            onClick={() => {
              requestedEmailCode.current = false;
              void signIn.reset();
            }}
            type="button"
            variant="link"
          >
            Use a different email
          </Button>
        </AuthLinks>
      </Form>
    );
  }

  return (
    <Form
      className="flex flex-col gap-4"
      errors={formErrors}
      onSubmit={(event) => {
        event.preventDefault();
        void submitEmail(new FormData(event.currentTarget));
      }}
    >
      <AuthHeading description="Use your email or continue with Google." title="Sign in" />
      <AuthGlobalErrors global={errors.global} />
      <EmailField autoFocus defaultValue={identifier} id="sign-in-email" />
      <Button loading={busy} type="submit">
        Continue
      </Button>
      <OrSeparator />
      <GoogleButton
        disabled={busy}
        label="Continue with Google"
        loading={oauthBusy}
        onClick={() => void startGoogle()}
      />
      <AuthLinks>
        <AuthLink to="/sign-up">Create an account</AuthLink>
        <AuthLink to="/forgot-password">Forgot password?</AuthLink>
      </AuthLinks>
    </Form>
  );
}
