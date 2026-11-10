import { OrganizationProfileCard } from "@/components/settings/organization/profile-card";
import { useAuth } from "@/lib/auth";

const manages = (role: string) => role === "owner" || role === "admin";

export function OrganizationSettings() {
  const { snapshot } = useAuth();
  const organization = snapshot?.status === "authenticated" ? snapshot.activeOrganization : null;

  if (!organization) return null;

  return (
    <OrganizationProfileCard editable={manages(organization.role)} organization={organization} />
  );
}
