import * as React from "react";

import { AuthBrand } from "@/components/auth/brand";
import { AuthModeToggle } from "@/components/auth/mode-toggle";
import { PasswordInput } from "@/components/auth/password-input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Fieldset } from "@/components/ui/fieldset";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { WindowControls } from "@/components/window-controls";
import { getErrorMessage, type AuthSnapshot } from "@/lib/auth";

function formValue(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

type AuthFormErrors = Record<string, string | string[]>;

export function AuthPage({ bridgeError }: { bridgeError?: string | null }) {
  const [mode, setMode] = React.useState<"sign-in" | "sign-up">("sign-in");
  const [pending, setPending] = React.useState(false);
  const [errors, setErrors] = React.useState<AuthFormErrors>({});
  const [password, setPassword] = React.useState("");

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setErrors({});
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
      setErrors({ password: getErrorMessage(cause) });
    } finally {
      setPending(false);
    }
  }

  function toggleMode() {
    setMode(mode === "sign-in" ? "sign-up" : "sign-in");
    setErrors({});
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
            <Form id="auth-form" errors={errors} onChange={() => setErrors({})} onSubmit={submit}>
              <Fieldset className="flex w-full flex-col gap-6">
                <div className="flex flex-col items-center gap-1 text-center">
                  <h1 className="text-2xl font-medium">
                    {mode === "sign-in" ? "Welcome back" : "Set up your store"}
                  </h1>
                </div>
                {mode === "sign-up" && (
                  <Field name="name">
                    <FieldLabel htmlFor="name">Your name</FieldLabel>
                    <Input id="name" name="name" autoComplete="name" required />
                    <FieldError />
                  </Field>
                )}
                <Field name="email">
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="m@example.com"
                    autoComplete="email"
                    required
                  />
                  <FieldError />
                </Field>
                <Field name="password">
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <PasswordInput
                    id="password"
                    name="password"
                    autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                    minLength={8}
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <FieldError />
                </Field>
                <Field>
                  <Button type="submit" disabled={pending} loading={pending} className="w-full">
                    {mode === "sign-in" ? "Sign in" : "Create account"}
                  </Button>
                  <FieldDescription className="mx-auto mt-2 text-center">
                    <AuthModeToggle mode={mode} onToggle={toggleMode} />
                  </FieldDescription>
                </Field>
              </Fieldset>
            </Form>
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
