import * as React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  PageContent,
  PageDescription,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/page-layout";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { getErrorMessage, type AuthSnapshot, useAuth } from "@/lib/auth";
import { toast } from "sonner";

export function SettingsPage() {
  const { snapshot } = useAuth();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function createOrganization(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("organizationName");
    const name = typeof value === "string" ? value : "";
    setPending(true);
    setError(null);
    try {
      if (!window.auth) throw new Error("Authentication is unavailable.");
      const next = await window.auth.createOrganization({ name });
      window.dispatchEvent(new CustomEvent<AuthSnapshot>("auth:session", { detail: next }));
      event.currentTarget.reset();
      toast.success("Organization created");
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <PageLayout contentClassName="max-w-3xl">
      <PageHeader className="gap-2">
        <p className="text-sm font-medium text-primary">Preferences</p>
        <PageHeading>Settings</PageHeading>
        <PageDescription>
          This route is ready for your persistent Electron settings.
        </PageDescription>
      </PageHeader>

      <PageContent>
        <Card>
          <CardHeader>
            <CardTitle>Organization</CardTitle>
            <CardDescription>
              Store data is shared with everyone in the active organization.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {snapshot?.activeOrganization?.name ?? "No organization selected"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {snapshot?.organizations.length ?? 0} available organization
                  {snapshot?.organizations.length === 1 ? "" : "s"}
                </p>
              </div>
              {snapshot?.activeOrganization && (
                <Badge variant="secondary">{snapshot.activeOrganization.role}</Badge>
              )}
            </div>
            <Separator />
            <form id="create-organization-form" onSubmit={createOrganization}>
              <FieldGroup>
                <Field data-invalid={Boolean(error)}>
                  <FieldLabel htmlFor="new-organization-name">New organization</FieldLabel>
                  <Input
                    id="new-organization-name"
                    name="organizationName"
                    placeholder="Store name"
                    required
                    aria-invalid={Boolean(error)}
                  />
                  {error && <FieldError>{error}</FieldError>}
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
          <CardFooter>
            <Button form="create-organization-form" type="submit" disabled={pending}>
              {pending && <Spinner data-icon="inline-start" />}Create organization
            </Button>
          </CardFooter>
        </Card>
      </PageContent>
    </PageLayout>
  );
}
