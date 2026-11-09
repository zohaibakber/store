import { AlertCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { LoadingSpinner } from "@/components/app/loading-spinner";
import { OrganizationProfileCard } from "@/components/settings/organization/profile-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { OrganizationProvider, useOrganization } from "@/lib/organization";

const manages = (role: string) => role === "owner" || role === "admin";

function OrganizationPanel() {
  const { state, actions } = useOrganization();

  if (state.error) {
    return (
      <Alert variant="error">
        <HugeiconsIcon aria-hidden="true" icon={AlertCircleIcon} />
        <AlertTitle>Could not load the organization</AlertTitle>
        <AlertDescription>
          {state.error}
          <Button
            className="self-start"
            onClick={() => void actions.reload()}
            size="sm"
            variant="outline"
          >
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!state.organization) {
    return <LoadingSpinner className="h-44" label="Loading organization" />;
  }

  const { organization } = state;

  return (
    <div className="flex flex-col gap-4 transition-opacity duration-200 starting:opacity-0">
      <OrganizationProfileCard editable={manages(organization.role)} organization={organization} />
    </div>
  );
}

export function OrganizationSettings() {
  const auth = useAuth();

  if (auth.snapshot?.status !== "authenticated") return null;

  return (
    <OrganizationProvider>
      <OrganizationPanel />
    </OrganizationProvider>
  );
}
