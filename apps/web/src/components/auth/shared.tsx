import { EyeClosedIcon, EyeIcon, GoogleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import * as React from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { OTPField, OTPFieldInput, OTPFieldSeparator } from "@/components/ui/otp-field";
import { Separator } from "@/components/ui/separator";
import type { ClerkErrorFields, ClerkGlobalError } from "@/lib/clerk-errors";
import { clerkFormErrors, clerkGlobalMessages, compactFormErrors } from "@/lib/clerk-errors";
import { isString } from "@/lib/predicates";

export const OTP_LENGTH = 6;
const OTP_SLOT_KEYS = Array.from({ length: OTP_LENGTH }, (_, index) => `otp-slot-${index}`);

export const formText = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return isString(value) ? value : "";
};

export function AuthHeading({ description, title }: { description?: string; title: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-lg font-medium">{title}</h1>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export function AuthGlobalErrors({ global }: { global: ReadonlyArray<ClerkGlobalError> | null }) {
  const messages = clerkGlobalMessages(global);
  if (messages.length === 0) return null;
  return (
    <Alert variant="error">
      <AlertDescription>{messages.join(" ")}</AlertDescription>
    </Alert>
  );
}

export function AuthCaptcha() {
  return <div id="clerk-captcha" />;
}

export function OrSeparator() {
  return (
    <div className="flex items-center gap-3">
      <Separator className="flex-1" />
      <span className="text-xs text-muted-foreground">or</span>
      <Separator className="flex-1" />
    </div>
  );
}

export function EmailField({
  autoFocus,
  defaultValue,
  id,
}: {
  autoFocus?: boolean;
  defaultValue?: string;
  id: string;
}) {
  return (
    <Field name="email">
      <FieldLabel htmlFor={id}>Email</FieldLabel>
      <Input
        autoComplete="email"
        autoFocus={autoFocus}
        defaultValue={defaultValue}
        id={id}
        name="email"
        required
        type="email"
      />
      <FieldError />
    </Field>
  );
}

export function PasswordField({
  autoComplete,
  autoFocus,
  id,
  label = "Password",
}: {
  autoComplete: "current-password" | "new-password";
  autoFocus?: boolean;
  id: string;
  label?: string;
}) {
  const [visible, setVisible] = React.useState(false);
  const actionLabel = visible ? "Hide password" : "Show password";

  return (
    <Field name="password">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          id={id}
          name="password"
          required
          type={visible ? "text" : "password"}
        />
        <InputGroupAddon align="inline-end">
          <Button
            aria-label={actionLabel}
            onClick={() => setVisible((current) => !current)}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <HugeiconsIcon aria-hidden="true" icon={visible ? EyeClosedIcon : EyeIcon} />
          </Button>
        </InputGroupAddon>
      </InputGroup>
      <FieldError />
    </Field>
  );
}

export function GoogleButton({
  disabled,
  label,
  loading,
  onClick,
}: {
  disabled?: boolean;
  label: string;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      className="w-full"
      disabled={disabled}
      loading={loading}
      onClick={onClick}
      type="button"
      variant="outline"
    >
      <HugeiconsIcon aria-hidden="true" icon={GoogleIcon} />
      {label}
    </Button>
  );
}

export function AuthLinks({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col items-start gap-1">{children}</div>;
}

export function AuthLink({
  children,
  to,
}: {
  children: React.ReactNode;
  to: "/sign-in" | "/sign-up" | "/forgot-password";
}) {
  return (
    <Button className="h-auto px-0 text-sm" render={<Link to={to} />} variant="link">
      {children}
    </Button>
  );
}

export function VerificationForm({
  description,
  disabled,
  fields,
  global,
  onResend,
  onReset,
  onSubmit,
}: {
  description: string;
  disabled: boolean;
  fields: ClerkErrorFields;
  global: ReadonlyArray<ClerkGlobalError> | null;
  onResend: () => void;
  onReset?: () => void;
  onSubmit: (code: string) => Promise<void>;
}) {
  const [code, setCode] = React.useState("");
  const submittingRef = React.useRef(false);
  const formErrors = compactFormErrors(clerkFormErrors(fields));
  const submit = async (value: string) => {
    if (disabled || submittingRef.current || value.length !== OTP_LENGTH) return;
    submittingRef.current = true;
    try {
      await onSubmit(value);
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <Form
      className="flex flex-col gap-4"
      errors={formErrors}
      onSubmit={(event) => {
        event.preventDefault();
        void submit(code);
      }}
    >
      <AuthHeading description={description} title="Check your email" />
      <AuthGlobalErrors global={global} />
      <Field name="code">
        <FieldLabel>Verification code</FieldLabel>
        <OTPField
          disabled={disabled}
          length={OTP_LENGTH}
          onValueChange={(value) => {
            setCode(value);
            void submit(value);
          }}
          value={code}
        >
          {OTP_SLOT_KEYS.map((slotKey, index) => (
            <React.Fragment key={slotKey}>
              {index === 3 ? <OTPFieldSeparator /> : null}
              <OTPFieldInput
                aria-label={index === 0 ? undefined : `Character ${index + 1} of ${OTP_LENGTH}`}
              />
            </React.Fragment>
          ))}
        </OTPField>
        <FieldDescription>Enter the {OTP_LENGTH}-digit code sent to your email.</FieldDescription>
        <FieldError />
      </Field>
      <Button loading={disabled} type="submit">
        Verify
      </Button>
      <AuthLinks>
        <Button disabled={disabled} onClick={onResend} type="button" variant="link">
          I need a new code
        </Button>
        {onReset ? (
          <Button disabled={disabled} onClick={onReset} type="button" variant="link">
            Use a different email
          </Button>
        ) : null}
      </AuthLinks>
    </Form>
  );
}
