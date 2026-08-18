import { FrameCard } from "@/components/shared/frame-card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { clerkAppearance, CreateOrganization } from "@/lib/clerk-runtime";

export function OrganizationSettings() {
  const { snapshot } = useAuth();
  const organization = snapshot?.activeOrganization;

  return (
    <div className="flex flex-col gap-4">
      <FrameCard
        action={organization ? <Badge variant="secondary">{organization.role}</Badge> : null}
        description="Store data syncs to this organization."
        title="Organization"
      >
        <p className="truncate font-medium">{organization?.name ?? "No organization"}</p>
        <p className="text-sm text-muted-foreground">
          {snapshot?.user?.email ?? "—"} is signed in to this workspace.
        </p>
      </FrameCard>

      <FrameCard
        description="Starts a separate workspace with its own catalog and invoices."
        title="New organization"
      >
        <CreateOrganization appearance={clerkAppearance} />
      </FrameCard>
    </div>
  );
}
