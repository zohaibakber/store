import * as React from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { WindowControls } from "@/components/window-controls";
import { getErrorMessage, type AuthSnapshot } from "@/lib/auth";
import { AuthBrand } from "@/components/auth/auth-brand";
import { AuthModeToggle } from "@/components/auth/auth-mode-toggle";
import { AuthPasswordInput } from "@/components/auth/auth-password-input";

function formValue(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export function AuthPage({ bridgeError }: { bridgeError?: string | null }) {
  const [mode, setMode] = React.useState<"sign-in" | "sign-up">("sign-in");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(bridgeError ?? null);
  const [password, setPassword] = React.useState("");

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      if (!window.auth) throw new Error("Authentication is unavailable in this build.");
      const email = formValue(form, "email");
      const password = formValue(form, "password");
      const next: AuthSnapshot =
        mode === "sign-in"
          ? await window.auth.signIn({ email, password })
          : await window.auth.signUp({
              name: formValue(form, "name"),
              email,
              password,
            });
      window.dispatchEvent(new CustomEvent<AuthSnapshot>("auth:session", { detail: next }));
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  function toggleMode() {
    setMode(mode === "sign-in" ? "sign-up" : "sign-in");
    setError(null);
    setPassword("");
  }

  return (
    <div className="relative flex min-h-svh flex-col">
      <header className="absolute inset-x-0 top-0 z-10 flex h-12 items-center px-2 [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]">
        <WindowControls />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6 md:p-10">
        <AuthBrand />
        <div className="flex w-full justify-center">
          <div className="w-full max-w-xs">
            <form id="auth-form" onSubmit={submit}>
              <FieldGroup>
                <div className="flex flex-col items-center gap-1 text-center">
                  <h1 className="text-2xl font-bold">
                    {mode === "sign-in" ? "Welcome back" : "Set up your store"}
                  </h1>
                </div>
                {mode === "sign-up" && (
                  <Field>
                    <FieldLabel htmlFor="name">Your name</FieldLabel>
                    <Input id="name" name="name" autoComplete="name" required />
                  </Field>
                )}
                <Field data-invalid={Boolean(error)}>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="m@example.com"
                    autoComplete="email"
                    required
                    aria-invalid={Boolean(error)}
                  />
                </Field>
                <Field data-invalid={Boolean(error)}>
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <AuthPasswordInput
                    id="password"
                    name="password"
                    autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                    minLength={8}
                    required
                    aria-invalid={Boolean(error)}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  {error && <FieldError>{error}</FieldError>}
                </Field>
                <Field>
                  <Button type="submit" disabled={pending}>
                    {pending && <Spinner data-icon="inline-start" />}
                    {mode === "sign-in" ? "Sign in" : "Create account"}
                  </Button>
                  <FieldDescription className="text-center">
                    <AuthModeToggle mode={mode} onToggle={toggleMode} />
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </form>
            {bridgeError && (
              <Alert className="mt-6">
                <AlertTitle>Offline sign-in is not ready</AlertTitle>
                <AlertDescription>{bridgeError}</AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
