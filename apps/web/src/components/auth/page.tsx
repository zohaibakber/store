import { EmailAddress, OtpCode, Password, normalizeEmail, type LoginRoute } from "@store/auth";
import * as React from "react";

import { AuthScreen } from "@/components/auth/brand";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authenticate, beginGoogle, currentAuthClient, identify } from "@/lib/first-party-auth";

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
  cause instanceof Error ? cause.message : "Sign-in could not be completed.";

function IdentifierSignIn({
  busy,
  onContinue,
}: {
  readonly busy: boolean;
  readonly onContinue: (email: string) => Promise<void>;
}) {
  const [email, setEmail] = React.useState("");
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void onContinue(email);
      }}
    >
      <Field>
        <FieldLabel htmlFor="auth-email">Email</FieldLabel>
        <Input
          autoComplete="email"
          autoFocus
          id="auth-email"
          onChange={(event) => setEmail(event.currentTarget.value)}
          type="email"
          value={email}
        />
      </Field>
      <Button loading={busy} type="submit">
        Continue
      </Button>
      <Button disabled={busy} onClick={() => void beginGoogle()} type="button" variant="outline">
        Continue with Google
      </Button>
    </form>
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
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(password);
      }}
    >
      <Field>
        <FieldLabel htmlFor="auth-password">Password</FieldLabel>
        <Input
          autoComplete="current-password"
          autoFocus
          id="auth-password"
          onChange={(event) => setPassword(event.currentTarget.value)}
          type="password"
          value={password}
        />
        <FieldDescription>{email}</FieldDescription>
      </Field>
      <Button loading={busy} type="submit">
        Sign in
      </Button>
      <Button disabled={busy} onClick={onBack} type="button" variant="ghost">
        Use another email
      </Button>
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
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(code);
      }}
    >
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
        <FieldDescription>
          Email delivery is not enabled yet for {email}.
          {developmentCode ? ` Development code: ${developmentCode}` : ""}
        </FieldDescription>
      </Field>
      <Button loading={busy} type="submit">
        Verify
      </Button>
      <Button disabled={busy} onClick={onBack} type="button" variant="ghost">
        Use another email
      </Button>
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
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({ name, password });
      }}
    >
      <Field>
        <FieldLabel htmlFor="auth-name">Name</FieldLabel>
        <Input
          autoComplete="name"
          autoFocus
          id="auth-name"
          onChange={(event) => setName(event.currentTarget.value)}
          value={name}
        />
        <FieldDescription>This account will use {email}.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="auth-new-password">Password</FieldLabel>
        <Input
          autoComplete="new-password"
          id="auth-new-password"
          onChange={(event) => setPassword(event.currentTarget.value)}
          type="password"
          value={password}
        />
        <FieldDescription>
          Use 10 to 100 characters. Spaces at the edges are rejected.
        </FieldDescription>
      </Field>
      <Button loading={busy} type="submit">
        Create account
      </Button>
      <Button disabled={busy} onClick={onBack} type="button" variant="ghost">
        Use another email
      </Button>
    </form>
  );
}

export function AuthForm() {
  const [step, setStep] = React.useState<AuthStep>({ _tag: "Identifier" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };
  const startOver = () => {
    setError(null);
    setStep({ _tag: "Identifier" });
  };

  return (
    <div className="flex w-full max-w-sm flex-col gap-5">
      <div className="space-y-1">
        <h2 className="text-lg font-medium">Sign in to sync</h2>
        <p className="text-sm text-muted-foreground">
          Your local inventory works without an account. Sign in to sync it across devices.
        </p>
      </div>
      {error ? (
        <Alert variant="error">
          <AlertTitle>Could not continue</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {step._tag === "Identifier" ? (
        <IdentifierSignIn
          busy={busy}
          onContinue={(email) =>
            run(async () => {
              const route = await identify({ email: EmailAddress.make(normalizeEmail(email)) });
              setStep(route);
            })
          }
        />
      ) : null}
      {step._tag === "Password" ? (
        <PasswordSignIn
          busy={busy}
          email={step.email}
          onBack={startOver}
          onSubmit={(password) =>
            run(async () => {
              await authenticate({
                _tag: "Password",
                email: step.email,
                password: Password.make(password),
                client: currentAuthClient(),
              });
            })
          }
        />
      ) : null}
      {step._tag === "Otp" ? (
        <OtpSignIn
          busy={busy}
          developmentCode={step.developmentCode}
          email={step.email}
          onBack={startOver}
          onSubmit={(code) =>
            run(async () => {
              await authenticate({
                _tag: "Otp",
                challengeId: step.challengeId,
                code: OtpCode.make(code),
                client: currentAuthClient(),
              });
            })
          }
        />
      ) : null}
      {step._tag === "Registration" ? (
        <PasswordRegistration
          busy={busy}
          email={step.email}
          onBack={startOver}
          onSubmit={(input) =>
            run(async () => {
              await authenticate({
                _tag: "RegisterPassword",
                email: step.email,
                name: input.name.trim(),
                password: Password.make(input.password),
                client: currentAuthClient(),
              });
            })
          }
        />
      ) : null}
    </div>
  );
}

export function AuthPage() {
  return (
    <AuthScreen>
      <AuthForm />
    </AuthScreen>
  );
}
