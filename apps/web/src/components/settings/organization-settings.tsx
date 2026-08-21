import { AlertCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { AcceptInvitationCard } from "@/components/settings/organization/accept-invitation-card";
import { OrganizationInvitationsCard } from "@/components/settings/organization/invitations-card";
import { OrganizationMembersCard } from "@/components/settings/organization/members-card";
import { OrganizationProfileCard } from "@/components/settings/organization/profile-card";
import { FrameCard } from "@/components/shared/frame-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { OrganizationProvider, useOrganization } from "@/lib/organization";

const manages = (role: string) => role === "owner" || role === "admin";

function OrganizationPanel({ userId }: { userId: string }) {
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

  if (!state.roster) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-44 w-full rounded-2xl" />
        <Skeleton className="h-56 w-full rounded-2xl" />
      </div>
    );
  }

  const { organization, members, invitations } = state.roster;
  const editable = manages(organization.role);

  return (
    <div className="flex flex-col gap-6 transition-opacity duration-200 starting:opacity-0">
      <OrganizationProfileCard editable={editable} organization={organization} />
      {editable ? (
        <OrganizationInvitationsCard invitations={invitations} organization={organization} />
      ) : null}
      <OrganizationMembersCard
        currentUserId={userId}
        members={members}
        organization={organization}
      />
      <AcceptInvitationCard />
    </div>
  );
}

export function OrganizationSettings() {
  const auth = useAuth();
  const snapshot = auth.snapshot?.status === "authenticated" ? auth.snapshot : null;

  if (!snapshot) {
    return (
      <FrameCard description="Store data syncs to an organization." title="Organization">
        <p className="truncate font-medium">Local workspace</p>
        <p className="text-sm text-muted-foreground">
          Sign in on the Account tab to sync this device with a store.
        </p>
      </FrameCard>
    );
  }

  return (
    <OrganizationProvider>
      <OrganizationPanel userId={snapshot.user.id} />
    </OrganizationProvider>
  );
}
