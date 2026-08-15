import * as React from "react";

import { AuthBrand } from "@/components/auth/brand";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authSession } from "@/lib/auth";
import { useAuth as useClerkAuth, useOrganizationList } from "@/lib/clerk-runtime";
import {
  activateOrganizationSession,
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
  const attemptedOrganization = React.useRef<string | null>(null);

  const memberships = userMemberships.data ?? [];
  const existingOrganizationId = memberships[0]?.organization.id ?? null;

  const activateExisting = React.useCallback(
    async (organizationId: string) => {
      setPending(true);
      setError(null);
      try {
        if (!isLoaded || !setActive) throw new Error("Organization setup is still loading.");
        await activateOrganizationSession({
          organizationId,
          setActive: (id) => setActive({ organization: id }),
          getToken: () => getToken(clerkSessionTokenOptions),
          adoptSession: (token) => authSession().adoptSession(token),
        });
      } catch (cause) {
        setError(storeErrorMessage(cause, "The organization could not be opened."));
        setPending(false);
      }
    },
    [getToken, isLoaded, setActive],
  );

  React.useEffect(() => {
    if (
      !isLoaded ||
      !setActive ||
      !existingOrganizationId ||
      attemptedOrganization.current === existingOrganizationId
    )
      return;
    attemptedOrganization.current = existingOrganizationId;
    void activateExisting(existingOrganizationId);
  }, [activateExisting, existingOrganizationId, isLoaded, setActive]);

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

  if (existingOrganizationId) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-center text-sm text-muted-foreground">
          {pending ? "Opening your organization…" : "Your organization is ready to open."}
        </p>
        {error ? (
          <Alert variant="error">
            <AlertTitle>Organization could not open</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button
          className="w-full"
          disabled={!isLoaded || !setActive}
          loading={pending}
          onClick={() => void activateExisting(existingOrganizationId)}
          type="button"
        >
          Open organization
        </Button>
      </div>
    );
  }

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
