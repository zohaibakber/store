import * as React from "react";
import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, MedicineBottle01Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { getErrorMessage, useAuth, type AuthSnapshot } from "@/lib/auth";

export function TeamSwitcher() {
  const { snapshot } = useAuth();
  const [pendingOrganization, setPendingOrganization] = React.useState<string | null>(null);
  if (!snapshot?.activeOrganization) return null;
  const { organizations, activeOrganization } = snapshot;

  async function switchOrganization(organizationId: string) {
    if (!window.auth || organizationId === activeOrganization.id) return;
    setPendingOrganization(organizationId);
    try {
      const next = await window.auth.switchOrganization({ organizationId });
      window.dispatchEvent(new CustomEvent<AuthSnapshot>("auth:session", { detail: next }));
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setPendingOrganization(null);
    }
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton className="w-fit px-1.5" />}>
            <div className="flex aspect-square size-5 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
              <HugeiconsIcon icon={MedicineBottle01Icon} className="size-3" />
            </div>
            <span className="truncate font-medium">{activeOrganization.name}</span>
            <HugeiconsIcon icon={ArrowDown01Icon} className="opacity-50" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-64 rounded-lg"
            align="start"
            side="bottom"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Organizations
              </DropdownMenuLabel>
              {organizations.map((organization) => (
                <DropdownMenuItem
                  key={organization.id}
                  onClick={() => void switchOrganization(organization.id)}
                  disabled={pendingOrganization !== null}
                  className="gap-2 p-2"
                >
                  <div className="flex size-6 items-center justify-center rounded-xs border">
                    {pendingOrganization === organization.id ? (
                      <Spinner />
                    ) : (
                      <HugeiconsIcon icon={MedicineBottle01Icon} className="size-4 shrink-0" />
                    )}
                  </div>
                  <span className="flex-1 truncate">{organization.name}</span>
                  {organization.id === activeOrganization.id && (
                    <span className="text-xs text-muted-foreground">Active</span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem className="gap-2 p-2" render={<Link to="/settings" />}>
                <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                  <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
                </div>
                <div className="font-medium text-muted-foreground">Add organization</div>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
