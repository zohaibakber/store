import * as React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkBadgeIcon, LogoutIcon, UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { getErrorMessage, useAuth, type AuthSnapshot } from "@/lib/auth";
import { toast } from "sonner";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

export function NavUser() {
  const { isMobile } = useSidebar();
  const { snapshot } = useAuth();
  const [pendingOrganization, setPendingOrganization] = React.useState<string | null>(null);
  if (!snapshot?.user) return null;
  const { user, organizations, activeOrganization } = snapshot;

  async function switchOrganization(organizationId: string) {
    if (!window.auth || organizationId === activeOrganization?.id) return;
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

  async function signOut() {
    try {
      await window.auth?.signOut();
      window.dispatchEvent(
        new CustomEvent<AuthSnapshot>("auth:session", {
          detail: {
            status: "unauthenticated",
            user: null,
            activeOrganization: null,
            organizations: [],
            isOnline: navigator.onLine,
          },
        }),
      );
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="aria-expanded:bg-muted aria-expanded:text-foreground"
              />
            }
          >
            <Avatar>
              <AvatarImage src={user.image ?? undefined} alt={user.name} />
              <AvatarFallback>{initials(user.name)}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{user.name}</span>
              <span className="truncate text-xs">{activeOrganization?.name ?? user.email}</span>
            </div>
            <HugeiconsIcon icon={UnfoldMoreIcon} className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <span className="block truncate font-medium">{user.name}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {user.email}
                </span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Organizations</DropdownMenuLabel>
              {organizations.map((organization) => (
                <DropdownMenuItem
                  key={organization.id}
                  onClick={() => void switchOrganization(organization.id)}
                  disabled={pendingOrganization !== null}
                >
                  {pendingOrganization === organization.id ? (
                    <Spinner />
                  ) : (
                    <HugeiconsIcon icon={CheckmarkBadgeIcon} />
                  )}
                  <span className="flex-1 truncate">{organization.name}</span>
                  {organization.id === activeOrganization?.id && (
                    <span className="text-xs text-muted-foreground">Active</span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => void signOut()}>
                <HugeiconsIcon icon={LogoutIcon} />
                Log out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
