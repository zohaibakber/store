import { FrameCard } from "@/components/shared/frame-card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";

export function OrganizationSettings() {
  const auth = useAuth();
  const snapshot = auth.snapshot?.status === "authenticated" ? auth.snapshot : null;
  const organization = snapshot?.activeOrganization;

  return (
    <FrameCard
      action={organization ? <Badge variant="secondary">{organization.role}</Badge> : null}
      description="Store data syncs to this organization."
      title="Organization"
    >
      <p className="truncate font-medium">{organization?.name ?? "Local workspace"}</p>
      <p className="text-sm text-muted-foreground">
        {snapshot?.user.email ?? "Sign in to create a synced organization."}
      </p>
    </FrameCard>
  );
}
