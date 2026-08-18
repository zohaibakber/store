import * as React from "react";

import {
  AuthGlobalErrors,
  AuthHeading,
  AuthLink,
  AuthLinks,
  EmailField,
  formText,
  PasswordField,
  VerificationForm,
} from "@/components/auth/shared";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { clerkFormErrors, compactFormErrors } from "@/lib/clerk-errors";
import { finalizeIfComplete, hasEmailCodeSecondFactor } from "@/lib/clerk-flow";
import { useSignIn } from "@/lib/clerk-runtime";

export function ForgotPasswordForm() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const busy = fetchStatus === "fetching";
  const formErrors = compactFormErrors(clerkFormErrors(errors.fields));
  const identifier = signIn.identifier ?? "";
  const needsNewPassword = signIn.status === "needs_new_password";
  const needsMfa =
    signIn.status === "needs_client_trust" || signIn.status === "needs_second_factor";
  const [codeSent, setCodeSent] = React.useState(false);
  const awaitingCode = codeSent && !needsNewPassword && !needsMfa && signIn.status !== "complete";

  const sendCode = async (formData: FormData) => {
    const { error: createError } = await signIn.create({
      identifier: formText(formData, "email"),
    });
    if (createError) return;
    const { error: sendError } = await signIn.resetPasswordEmailCode.sendCode();
    if (sendError) return;
    setCodeSent(true);
  };

  const verifyCode = async (code: string) => {
    await signIn.resetPasswordEmailCode.verifyCode({ code });
  };

  const submitPassword = async (formData: FormData) => {
    const { error } = await signIn.resetPasswordEmailCode.submitPassword({
      password: formText(formData, "password"),
      signOutOfOtherSessions: true,
    });
    if (error) return;
    if (await finalizeIfComplete(signIn)) return;
    if (signIn.status !== "needs_client_trust" && signIn.status !== "needs_second_factor") return;
    if (hasEmailCodeSecondFactor(signIn.supportedSecondFactors)) await signIn.mfa.sendEmailCode();
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
          setCodeSent(false);
          void signIn.reset();
        }}
        onSubmit={verifyMfa}
      />
    );
  }

  if (needsNewPassword) {
    return (
      <Form
        className="flex flex-col gap-4"
        errors={formErrors}
        onSubmit={(event) => {
          event.preventDefault();
          void submitPassword(new FormData(event.currentTarget));
        }}
      >
        <AuthHeading
          description="Choose a new password for your account."
          title="Set a new password"
        />
        <AuthGlobalErrors global={errors.global} />
        <PasswordField
          autoComplete="new-password"
          autoFocus
          id="forgot-password-new"
          label="New password"
        />
        <Button loading={busy} type="submit">
          Update password
        </Button>
      </Form>
    );
  }

  if (awaitingCode) {
    return (
      <VerificationForm
        description={`A reset code has been sent to ${identifier || "your email"}.`}
        disabled={busy}
        fields={errors.fields}
        global={errors.global}
        onResend={() => void signIn.resetPasswordEmailCode.sendCode()}
        onReset={() => {
          setCodeSent(false);
          void signIn.reset();
        }}
        onSubmit={verifyCode}
      />
    );
  }

  return (
    <Form
      className="flex flex-col gap-4"
      errors={formErrors}
      onSubmit={(event) => {
        event.preventDefault();
        void sendCode(new FormData(event.currentTarget));
      }}
    >
      <AuthHeading
        description="We’ll email you a code to reset your password."
        title="Forgot password"
      />
      <AuthGlobalErrors global={errors.global} />
      <EmailField autoFocus defaultValue={identifier} id="forgot-password-email" />
      <Button loading={busy} type="submit">
        Send reset code
      </Button>
      <AuthLinks>
        <AuthLink to="/sign-in">Back to sign in</AuthLink>
      </AuthLinks>
    </Form>
  );
}
