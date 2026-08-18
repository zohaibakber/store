import { useNavigate } from "@tanstack/react-router";
import * as React from "react";

import {
  AuthCaptcha,
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
import { finalizeIfComplete, googleSsoParams, settleOAuth } from "@/lib/clerk-flow";
import { useClerk, useSignIn, useSignUp } from "@/lib/clerk-runtime";

const needsEmailVerification = (signUp: ReturnType<typeof useSignUp>["signUp"]) =>
  signUp.status === "missing_requirements" &&
  signUp.unverifiedFields.includes("email_address") &&
  !signUp.missingFields.includes("password");

const needsPassword = (signUp: ReturnType<typeof useSignUp>["signUp"]) =>
  signUp.status === "missing_requirements" && signUp.missingFields.includes("password");

const sendEmailCodeIfNeeded = async (signUp: ReturnType<typeof useSignUp>["signUp"]) => {
  if (!needsEmailVerification(signUp)) return;
  await signUp.verifications.sendEmailCode();
};

export function SignUpForm() {
  const { signUp, errors, fetchStatus } = useSignUp();
  const { signIn } = useSignIn();
  const clerk = useClerk();
  const navigate = useNavigate();
  const [oauthBusy, setOauthBusy] = React.useState(false);
  const fetching = fetchStatus === "fetching";
  const busy = fetching || oauthBusy;
  const formErrors = compactFormErrors(clerkFormErrors(errors.fields));
  const email = signUp.emailAddress ?? "";

  const startGoogle = async () => {
    setOauthBusy(true);
    try {
      const { error } = await signUp.sso(googleSsoParams());
      if (error) return;
      const result = await settleOAuth({ clerk, signIn, signUp });
      if (result.kind === "continue" && result.path !== "/sign-up") {
        await navigate({ to: result.path });
      }
    } finally {
      setOauthBusy(false);
    }
  };

  const submitEmail = async (formData: FormData) => {
    const { error } = await signUp.create({ emailAddress: formText(formData, "email") });
    if (error) return;
    if (await finalizeIfComplete(signUp)) return;
    if (needsPassword(signUp)) return;
    await sendEmailCodeIfNeeded(signUp);
  };

  const submitPassword = async (formData: FormData) => {
    const { error } = await signUp.password({ password: formText(formData, "password") });
    if (error) return;
    if (await finalizeIfComplete(signUp)) return;
    await sendEmailCodeIfNeeded(signUp);
  };

  const verifyEmail = async (code: string) => {
    const { error } = await signUp.verifications.verifyEmailCode({ code });
    if (error) return;
    await finalizeIfComplete(signUp);
  };

  if (needsEmailVerification(signUp)) {
    return (
      <VerificationForm
        description={`A verification code has been sent to ${email || "your email"}.`}
        disabled={busy}
        fields={errors.fields}
        global={errors.global}
        onResend={() => void signUp.verifications.sendEmailCode()}
        onReset={() => void signUp.reset()}
        onSubmit={verifyEmail}
      />
    );
  }

  if (needsPassword(signUp)) {
    return (
      <Form
        className="flex flex-col gap-4"
        errors={formErrors}
        onSubmit={(event) => {
          event.preventDefault();
          void submitPassword(new FormData(event.currentTarget));
        }}
      >
        <AuthHeading description={email} title="Create a password" />
        <AuthGlobalErrors global={errors.global} />
        <PasswordField autoComplete="new-password" autoFocus id="sign-up-password" />
        <AuthCaptcha />
        <Button loading={busy} type="submit">
          Continue
        </Button>
        <Button disabled={busy} onClick={() => void signUp.reset()} type="button" variant="link">
          Use a different email
        </Button>
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
      <AuthHeading
        description="Use your email or continue with Google."
        title="Create an account"
      />
      <AuthGlobalErrors global={errors.global} />
      <EmailField autoFocus defaultValue={email} id="sign-up-email" />
      <AuthCaptcha />
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
        <AuthLink to="/sign-in">Already have an account? Sign in</AuthLink>
      </AuthLinks>
    </Form>
  );
}
