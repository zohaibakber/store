import { EmailAddress, OtpCode, Password, normalizeEmail, type LoginRoute } from "@store/auth";
import { Link } from "@tanstack/react-router";
import * as React from "react";

import { WindowDragStrip } from "@/components/app/window-controls";
import { PasswordInput } from "@/components/auth/password-input";
import { BrandMark } from "@/components/brand-mark";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { appHost } from "@/host";
import { reportError } from "@/lib/report-error";
import { cn } from "@/lib/utils";

type AuthStep =
  | { readonly _tag: "Identifier" }
  | { readonly _tag: "Password"; readonly email: typeof EmailAddress.Type }
  | {
      readonly _tag: "Otp";
      readonly email: typeof EmailAddress.Type;
      readonly challengeId: Extract<LoginRoute, { readonly _tag: "Otp" }>["challengeId"];
      readonly developmentCode?: typeof OtpCode.Type;
    }
  | { readonly _tag: "Registration"; readonly email: typeof EmailAddress.Type };

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Could not sign in.";

export function AuthScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <WindowDragStrip />
      <div className="relative z-10 w-full max-w-sm">{children}</div>
    </div>
  );
}

function AuthHeader({
  description,
  title,
}: {
  readonly description?: React.ReactNode;
  readonly title: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <Link className="flex flex-col items-center gap-2 font-medium" to="/">
        <div className="flex size-8 items-center justify-center rounded-md">
          <BrandMark className="size-8 rounded-md" />
        </div>
        <span className="sr-only">Tabaaq</span>
      </Link>
      <h1 className="text-lg font-medium">{title}</h1>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}

function OrSeparator() {
  return (
    <div className="flex items-center gap-3">
      <Separator className="flex-1" />
      <span className="text-xs text-muted-foreground">Or</span>
      <Separator className="flex-1" />
    </div>
  );
}

function IdentifierSignIn({
  emailBusy,
  googleBusy,
  onContinue,
  onGoogle,
}: {
  readonly emailBusy: boolean;
  readonly googleBusy: boolean;
  readonly onContinue: (email: string) => Promise<void>;
  readonly onGoogle: () => Promise<void>;
}) {
  const [email, setEmail] = React.useState("");
  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void onContinue(email);
        }}
      >
        <AuthHeader title="Sign in to Tabaaq" />
        <Field>
          <FieldLabel htmlFor="auth-email">Email</FieldLabel>
          <Input
            autoComplete="email"
            autoFocus
            id="auth-email"
            onChange={(event) => setEmail(event.currentTarget.value)}
            placeholder="m@example.com"
            type="email"
            value={email}
          />
        </Field>
        <Field>
          <Button className="w-full" loading={emailBusy} type="submit">
            Continue
          </Button>
        </Field>
        <OrSeparator />
        <Field>
          <Button
            className="w-full"
            loading={googleBusy}
            onClick={() => void onGoogle()}
            type="button"
            variant="outline"
          >
            <img alt="" aria-hidden="true" className="size-4" src="/google.svg" />
            Continue with Google
          </Button>
        </Field>
      </form>
    </div>
  );
}

function PasswordSignIn({
  busy,
  email,
  onBack,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly email: typeof EmailAddress.Type;
  readonly onBack: () => void;
  readonly onSubmit: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = React.useState("");
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(password);
      }}
    >
      <AuthHeader
        description={
          <>
            Signing in as {email}.{" "}
            <button
              className="underline underline-offset-4 hover:text-foreground"
              disabled={busy}
              onClick={onBack}
              type="button"
            >
              Use another email
            </button>
          </>
        }
        title="Enter your password"
      />
      <Field>
        <FieldLabel htmlFor="auth-password">Password</FieldLabel>
        <PasswordInput
          autoComplete="current-password"
          autoFocus
          id="auth-password"
          onChange={(event) => setPassword(event.currentTarget.value)}
          value={password}
        />
      </Field>
      <Field>
        <Button className="w-full" loading={busy} type="submit">
          Sign in
        </Button>
      </Field>
    </form>
  );
}

function OtpSignIn({
  busy,
  developmentCode,
  email,
  onBack,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly developmentCode?: typeof OtpCode.Type;
  readonly email: typeof EmailAddress.Type;
  readonly onBack: () => void;
  readonly onSubmit: (code: string) => Promise<void>;
}) {
  const [code, setCode] = React.useState("");
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(code);
      }}
    >
      <AuthHeader
        description={
          <>
            Email delivery is not enabled yet for {email}.
            {developmentCode ? ` Development code: ${developmentCode}` : ""}{" "}
            <button
              className="underline underline-offset-4 hover:text-foreground"
              disabled={busy}
              onClick={onBack}
              type="button"
            >
              Use another email
            </button>
          </>
        }
        title="Enter your code"
      />
      <Field>
        <FieldLabel htmlFor="auth-code">One-time code</FieldLabel>
        <Input
          autoComplete="one-time-code"
          autoFocus
          id="auth-code"
          inputMode="numeric"
          maxLength={6}
          onChange={(event) => setCode(event.currentTarget.value)}
          value={code}
        />
      </Field>
      <Field>
        <Button className="w-full" loading={busy} type="submit">
          Verify
        </Button>
      </Field>
    </form>
  );
}

function PasswordRegistration({
  busy,
  email,
  onBack,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly email: typeof EmailAddress.Type;
  readonly onBack: () => void;
  readonly onSubmit: (input: { readonly name: string; readonly password: string }) => Promise<void>;
}) {
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({ name, password });
      }}
    >
      <AuthHeader
        description={
          <>
            Create an account for {email}.{" "}
            <button
              className="underline underline-offset-4 hover:text-foreground"
              disabled={busy}
              onClick={onBack}
              type="button"
            >
              Use another email
            </button>
          </>
        }
        title="Create your account"
      />
      <Field>
        <FieldLabel htmlFor="auth-name">Name</FieldLabel>
        <Input
          autoComplete="name"
          autoFocus
          id="auth-name"
          onChange={(event) => setName(event.currentTarget.value)}
          value={name}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="auth-new-password">Password</FieldLabel>
        <PasswordInput
          autoComplete="new-password"
          id="auth-new-password"
          onChange={(event) => setPassword(event.currentTarget.value)}
          value={password}
        />
        <FieldDescription>
          Use 10 to 100 characters. No leading or trailing spaces.
        </FieldDescription>
      </Field>
      <Field>
        <Button className="w-full" loading={busy} type="submit">
          Create account
        </Button>
      </Field>
    </form>
  );
}

type GoogleCallback = { readonly completing: boolean; readonly error: string | null };

export function useGoogleCallback(): GoogleCallback {
  const [state, setState] = React.useState<GoogleCallback>(() => ({
    completing: appHost().signIn.hasPendingOAuthCallback?.() ?? false,
    error: null,
  }));

  React.useEffect(
    () =>
      appHost().signIn.onOAuthCallback((url) => {
        setState({ completing: true, error: null });
        appHost()
          .signIn.completeGoogle(url)
          .then(
            (completed) => {
              if (!completed) setState({ completing: false, error: null });
            },
            (cause: unknown) => {
              reportError(cause, { op: "google-sign-in-callback" });
              setState({
                completing: false,
                error:
                  cause instanceof Error ? cause.message : "Google sign-in could not be completed.",
              });
            },
          );
      }),
    [],
  );

  return state;
}

export function AuthForm({
  className,
  callbackError = null,
  ...props
}: React.ComponentProps<"div"> & { readonly callbackError?: string | null }) {
  const [step, setStep] = React.useState<AuthStep>({ _tag: "Identifier" });
  const [busy, setBusy] = React.useState<"idle" | "email" | "google">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const shownError = error ?? callbackError;

  const run = async (lane: "email" | "google", operation: () => Promise<void>) => {
    setBusy(lane);
    setError(null);
    try {
      await operation();
      if (lane === "google") return;
    } catch (cause) {
      setError(messageOf(cause));
    }
    setBusy("idle");
  };
  const startOver = () => {
    setError(null);
    setBusy("idle");
    setStep({ _tag: "Identifier" });
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      {shownError ? (
        <Alert variant="error">
          <AlertTitle>Could not continue</AlertTitle>
          <AlertDescription>{shownError}</AlertDescription>
        </Alert>
      ) : null}
      {step._tag === "Identifier" ? (
        <IdentifierSignIn
          emailBusy={busy === "email"}
          googleBusy={busy === "google"}
          onContinue={(email) =>
            run("email", async () => {
              const route = await appHost().signIn.identify({
                email: EmailAddress.make(normalizeEmail(email)),
              });
              setStep(route);
            })
          }
          onGoogle={() => run("google", () => appHost().signIn.beginGoogle())}
        />
      ) : null}
      {step._tag === "Password" ? (
        <PasswordSignIn
          busy={busy === "email"}
          email={step.email}
          onBack={startOver}
          onSubmit={(password) =>
            run("email", async () => {
              await appHost().signIn.authenticate({
                _tag: "Password",
                email: step.email,
                password: Password.make(password),
              });
            })
          }
        />
      ) : null}
      {step._tag === "Otp" ? (
        <OtpSignIn
          busy={busy === "email"}
          developmentCode={step.developmentCode}
          email={step.email}
          onBack={startOver}
          onSubmit={(code) =>
            run("email", async () => {
              await appHost().signIn.authenticate({
                _tag: "Otp",
                challengeId: step.challengeId,
                code: OtpCode.make(code),
              });
            })
          }
        />
      ) : null}
      {step._tag === "Registration" ? (
        <PasswordRegistration
          busy={busy === "email"}
          email={step.email}
          onBack={startOver}
          onSubmit={(input) =>
            run("email", async () => {
              await appHost().signIn.authenticate({
                _tag: "RegisterPassword",
                email: step.email,
                name: input.name.trim(),
                password: Password.make(input.password),
              });
            })
          }
        />
      ) : null}
    </div>
  );
}
