import * as React from "react";

import { AuthBrand } from "@/components/auth/brand";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authSession } from "@/lib/auth";
import { useAuth as useClerkAuth, useOrganizationList } from "@/lib/clerk-runtime";
import {
  clerkPublishableKey,
  clerkSessionTokenOptions,
  createAndActivateOrganization,
} from "@/lib/clerk-workspace";
import { storeErrorMessage } from "@/lib/errors";

function OrganizationForm() {
  const { getToken } = useClerkAuth();
  const { createOrganization, isLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: { infinite: true },
  });
  const [name, setName] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const memberships = userMemberships.data ?? [];
  if (memberships.length > 0) {
    return <p className="text-center text-sm text-muted-foreground">Opening your organization…</p>;
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const organizationName = name.trim();
    if (!organizationName || pending) return;
    setPending(true);
    setError(null);
    try {
      if (!isLoaded || !createOrganization || !setActive) {
        throw new Error("Organization setup is still loading.");
      }
      await createAndActivateOrganization({
        name: organizationName,
        createOrganization,
        setActive: (organizationId) => setActive({ organization: organizationId }),
        getToken: () => getToken(clerkSessionTokenOptions),
        adoptSession: (token) => authSession().adoptSession(token),
      });
    } catch (cause) {
      setError(storeErrorMessage(cause, "The organization could not be created."));
      setPending(false);
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      <Field data-invalid={Boolean(error) || undefined} name="organizationName">
        <FieldLabel htmlFor="organization-name">Organization name</FieldLabel>
        <Input
          aria-invalid={Boolean(error) || undefined}
          autoComplete="organization"
          disabled={pending || !isLoaded}
          id="organization-name"
          maxLength={64}
          onChange={(event) => setName(event.target.value)}
          placeholder="Tabaaq"
          required
          type="text"
          value={name}
        />
        <FieldError match={Boolean(error)}>{error}</FieldError>
      </Field>
      <Button className="w-full" loading={pending} type="submit">
        Create organization
      </Button>
    </form>
  );
}

export function CreateOrganizationPage() {
  return (
    <main className="relative flex min-h-svh flex-col">
      <header className="absolute inset-x-0 top-0 z-10 h-12 [-webkit-app-region:drag]" />
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6 md:p-10">
        <AuthBrand />
        <div className="w-full max-w-xs">
          {clerkPublishableKey ? (
            <OrganizationForm />
          ) : (
            <Alert>
              <AlertTitle>Clerk is not configured</AlertTitle>
              <AlertDescription>
                Set VITE_CLERK_PUBLISHABLE_KEY so organization creation can load.
              </AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    </main>
  );
}
