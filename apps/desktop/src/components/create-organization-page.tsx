import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { MedicineBottle01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Fieldset } from "@/components/ui/fieldset";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { getErrorMessage, type AuthSnapshot } from "@/lib/auth";

export function CreateOrganizationPage() {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get("organizationName");
    setPending(true);
    setError(null);
    try {
      if (!window.auth) throw new Error("Authentication is unavailable in this build.");
      const next = await window.auth.createOrganization({
        name: typeof name === "string" ? name : "",
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
            <CardTitle>Create your organization</CardTitle>
            <CardDescription>The shared workspace your store data will sync to.</CardDescription>
          </CardHeader>
          <CardContent>
            <form id="create-organization-form" onSubmit={submit}>
              <Fieldset className="flex w-full flex-col gap-6">
                <Field data-invalid={Boolean(error)}>
                  <FieldLabel htmlFor="organizationName">Organization name</FieldLabel>
                  <Input
                    id="organizationName"
                    name="organizationName"
                    autoComplete="organization"
                    required
                    aria-invalid={error ? true : undefined}
                  />
                  {error && <FieldError match>{error}</FieldError>}
                </Field>
              </Fieldset>
            </form>
          </CardContent>
          <CardFooter>
            <Button
              className="w-full"
              form="create-organization-form"
              type="submit"
              disabled={pending}
            >
              {pending && <Spinner data-icon="inline-start" />}
              Create organization
            </Button>
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}
