import * as React from "react";
import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, MedicineBottle01Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { toast } from "@/lib/toast";

import {
  Menu,
  MenuPopup,
  MenuGroup,
  MenuItem,
  MenuGroupLabel,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
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
        <Menu>
          <MenuTrigger render={<SidebarMenuButton className="w-fit px-1.5" />}>
            {/* vite-plugin-electron builds with base: "./" so the packaged app can
                load index.html via file://; a root-absolute "/logo.svg" would
                resolve to the filesystem root instead of the public dir. */}
            <img
              src={`${import.meta.env.BASE_URL}logo.svg`}
              alt="Tabaaq"
              className="size-5 shrink-0 rounded-[5px]"
            />
            <span className="truncate font-medium">{activeOrganization.name}</span>
            <HugeiconsIcon icon={ArrowDown01Icon} className="opacity-50" />
          </MenuTrigger>
          <MenuPopup className="w-64 rounded-lg" align="start" side="bottom" sideOffset={4}>
            <MenuGroup>
              <MenuGroupLabel className="text-xs text-muted-foreground">
                Organizations
              </MenuGroupLabel>
              {organizations.map((organization) => (
                <MenuItem
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
                </MenuItem>
              ))}
            </MenuGroup>
            <MenuSeparator />
            <MenuGroup>
              <MenuItem className="gap-2 p-2" render={<Link to="/settings" />}>
                <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                  <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
                </div>
                <div className="font-medium text-muted-foreground">Add organization</div>
              </MenuItem>
            </MenuGroup>
          </MenuPopup>
        </Menu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
