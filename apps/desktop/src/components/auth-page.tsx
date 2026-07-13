import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { MedicineBottle01Icon } from "@hugeicons/core-free-icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { getErrorMessage, type AuthSnapshot } from "@/lib/auth";

function formValue(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export function AuthPage({ bridgeError }: { bridgeError?: string | null }) {
  const [mode, setMode] = React.useState<"sign-in" | "sign-up">("sign-in");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(bridgeError ?? null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
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

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <div className="flex items-center justify-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <HugeiconsIcon icon={MedicineBottle01Icon} />
          </div>
          <span className="text-base font-medium">Tabaaq</span>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{mode === "sign-in" ? "Welcome back" : "Set up your store"}</CardTitle>
            <CardDescription>
              {mode === "sign-in"
                ? "Sign in to open your organization and sync shared data."
                : "Create your account, then set up your organization."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form id="auth-form" onSubmit={submit}>
              <FieldGroup>
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
                    autoComplete="email"
                    required
                    aria-invalid={Boolean(error)}
                  />
                </Field>
                <Field data-invalid={Boolean(error)}>
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                    minLength={8}
                    required
                    aria-invalid={Boolean(error)}
                  />
                  {error && <FieldError>{error}</FieldError>}
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
          <CardFooter className="flex flex-col gap-2">
            <Button className="w-full" form="auth-form" type="submit" disabled={pending}>
              {pending && <Spinner data-icon="inline-start" />}
              {mode === "sign-in" ? "Sign in" : "Create account"}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              type="button"
              onClick={() => {
                setMode(mode === "sign-in" ? "sign-up" : "sign-in");
                setError(null);
              }}
            >
              {mode === "sign-in" ? "Create a new account" : "I already have an account"}
            </Button>
          </CardFooter>
        </Card>
        {bridgeError && (
          <Alert>
            <AlertTitle>Offline sign-in is not ready</AlertTitle>
            <AlertDescription>{bridgeError}</AlertDescription>
          </Alert>
        )}
      </div>
    </main>
  );
}
