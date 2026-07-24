import * as React from "react";

import { AuthBrand } from "@/components/auth/brand";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Fieldset } from "@/components/ui/fieldset";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { WindowControls } from "@/components/window-controls";
import { getErrorMessage, type AuthSnapshot } from "@/lib/auth";

type CreateOrganizationErrors = Record<string, string | string[]>;

export function CreateOrganizationPage() {
  const [pending, setPending] = React.useState(false);
  const [errors, setErrors] = React.useState<CreateOrganizationErrors>({});

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get("organizationName");
    setPending(true);
    setErrors({});
    try {
      if (!window.auth) throw new Error("Authentication is unavailable in this build.");
      const next = await window.auth.createOrganization({
        name: typeof name === "string" ? name : "",
      });
      window.dispatchEvent(new CustomEvent<AuthSnapshot>("auth:session", { detail: next }));
    } catch (cause) {
      setErrors({ organizationName: getErrorMessage(cause) });
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="relative flex min-h-svh flex-col">
      <header className="absolute inset-x-0 top-0 z-10 flex h-12 items-center px-2 [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]">
        <WindowControls />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6 md:p-10">
        <AuthBrand />
        <div className="w-full max-w-xs">
          <Form errors={errors} onChange={() => setErrors({})} onSubmit={submit}>
            <Fieldset className="flex w-full flex-col gap-6">
              <div className="flex flex-col items-center gap-1 text-center">
                <h1 className="text-2xl font-medium">Create your organization</h1>
                <p className="text-sm text-muted-foreground">
                  The workspace your store data will sync to.
                </p>
              </div>
              <Field name="organizationName">
                <FieldLabel htmlFor="organizationName">Organization name</FieldLabel>
                <Input
                  id="organizationName"
                  name="organizationName"
                  type="text"
                  autoComplete="organization"
                  autoFocus
                  required
                />
                <FieldError />
              </Field>
              <Field>
                <Button className="w-full" loading={pending} type="submit">
                  Create organization
                </Button>
              </Field>
            </Fieldset>
          </Form>
        </div>
      </div>
    </main>
  );
}
