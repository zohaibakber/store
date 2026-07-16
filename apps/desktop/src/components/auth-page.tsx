import * as React from "react";
import { Voronoi } from "@paper-design/shaders-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { MedicineBottle01Icon } from "@hugeicons/core-free-icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { WindowControls } from "@/components/window-controls";
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

  function toggleMode() {
    setMode(mode === "sign-in" ? "sign-up" : "sign-in");
    setError(null);
  }

  return (
    <div className="relative grid min-h-svh lg:grid-cols-2">
      <header className="absolute inset-x-0 top-0 z-10 flex h-12 items-center px-2 [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]">
        <WindowControls />
      </header>
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <span className="flex items-center gap-2 font-medium">
            <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <HugeiconsIcon icon={MedicineBottle01Icon} className="size-4" />
            </div>
            ZENO
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">
            <form id="auth-form" onSubmit={submit}>
              <FieldGroup>
                <div className="flex flex-col items-center gap-1 text-center">
                  <h1 className="text-2xl font-bold">
                    {mode === "sign-in" ? "Welcome back" : "Set up your store"}
                  </h1>
                  <p className="text-sm text-balance text-muted-foreground">
                    {mode === "sign-in"
                      ? "Sign in to open your organization and sync shared data."
                      : "Create your account, then set up your organization."}
                  </p>
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
                <Field>
                  <Button type="submit" disabled={pending}>
                    {pending && <Spinner data-icon="inline-start" />}
                    {mode === "sign-in" ? "Sign in" : "Create account"}
                  </Button>
                  <FieldDescription className="text-center">
                    {mode === "sign-in" ? (
                      <>
                        Don&apos;t have an account?{" "}
                        <button
                          type="button"
                          className="underline underline-offset-4"
                          onClick={toggleMode}
                        >
                          Sign up
                        </button>
                      </>
                    ) : (
                      <>
                        Already have an account?{" "}
                        <button
                          type="button"
                          className="underline underline-offset-4"
                          onClick={toggleMode}
                        >
                          Sign in
                        </button>
                      </>
                    )}
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
      <div className="relative hidden overflow-hidden lg:flex lg:items-center lg:justify-center">
        <Voronoi
          className="absolute inset-0 h-full w-full"
          colors={["#ffffff"]}
          colorGlow="#ffffff"
          colorGap="#000000"
          stepsPerColor={1}
          distortion={0.5}
          gap={0.03}
          glow={0.8}
          speed={0.5}
          scale={0.5}
        />
      </div>
    </div>
  );
}
