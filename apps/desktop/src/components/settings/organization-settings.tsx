import * as React from "react";
import { FrameCard } from "@/components/frame-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Fieldset } from "@/components/ui/fieldset";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { getErrorMessage, useAuth, type AuthSnapshot } from "@/lib/auth";

export function OrganizationSettings() {
  const { snapshot } = useAuth();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const organization = snapshot?.activeOrganization;

  async function createOrganization(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const value = new FormData(form).get("organizationName");
    setPending(true);
    setError(null);
    try {
      if (!window.auth) throw new Error("Authentication is unavailable.");
      const next = await window.auth.createOrganization({
        name: typeof value === "string" ? value : "",
      });
      window.dispatchEvent(new CustomEvent<AuthSnapshot>("auth:session", { detail: next }));
      form.reset();
      toastManager.add({ title: "Organization created", type: "success" });
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <FrameCard
        action={organization && <Badge variant="secondary">{organization.role}</Badge>}
        description="Store data syncs to this organization."
        title="Organization"
      >
        <p className="truncate font-medium">{organization?.name ?? "No organization"}</p>
        <p className="text-muted-foreground text-sm">
          {snapshot?.user?.email ?? "—"} is signed in to this workspace.
        </p>
      </FrameCard>

      <FrameCard
        description="Starts a separate workspace with its own catalog and invoices."
        title="New organization"
      >
        <form id="create-organization-form" onSubmit={createOrganization}>
          <Fieldset className="flex w-full flex-col gap-6">
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor="new-organization-name">Name</FieldLabel>
              <Input
                aria-invalid={error ? true : undefined}
                id="new-organization-name"
                name="organizationName"
                placeholder="Store name"
                required
              />
              <FieldDescription>
                You will be switched to it once it has been created.
              </FieldDescription>
              {error && <FieldError match>{error}</FieldError>}
            </Field>
            <div>
              <Button disabled={pending} form="create-organization-form" type="submit">
                {pending && <Spinner data-icon="inline-start" />}
                Create organization
              </Button>
            </div>
          </Fieldset>
        </form>
      </FrameCard>
    </div>
  );
}
