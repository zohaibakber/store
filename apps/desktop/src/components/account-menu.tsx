import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, LogoutIcon, SettingsIcon } from "@hugeicons/core-free-icons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuLinkItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { toastManager } from "@/components/ui/toast";
import { getErrorMessage, useAuth, type AuthSnapshot } from "@/lib/auth";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

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
    toastManager.add({ title: getErrorMessage(error), type: "error" });
  }
}

/**
 * One control for the signed-in identity: the organization names the workspace
 * and the account sits inside it. An account owns a single organization, so
 * there is nothing to switch between — hence no switcher.
 */
export function AccountMenu() {
  const { snapshot } = useAuth();
  if (!snapshot?.activeOrganization || !snapshot.user) return null;
  const { activeOrganization, user } = snapshot;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Menu>
          <MenuTrigger
            render={
              <SidebarMenuButton className="aria-expanded:bg-muted aria-expanded:text-foreground" />
            }
          >
            {/* vite-plugin-electron builds with base: "./" so the packaged app
                can load index.html via file://; a root-absolute "/logo.svg"
                would resolve to the filesystem root instead of the public dir. */}
            <img
              alt=""
              className="size-6 shrink-0 rounded-[5px]"
              src={`${import.meta.env.BASE_URL}logo.svg`}
            />
            <span className="min-w-0 flex-1 truncate text-left font-medium">
              {activeOrganization.name}
            </span>
            <HugeiconsIcon aria-hidden="true" className="ml-auto size-4" icon={ArrowDown01Icon} />
          </MenuTrigger>
          <MenuPopup align="start" className="w-64" side="bottom" sideOffset={4}>
            <MenuGroup>
              <MenuGroupLabel className="gap-2">
                <Avatar className="size-6">
                  <AvatarImage alt={user.name} src={user.image ?? undefined} />
                  <AvatarFallback>{initials(user.name)}</AvatarFallback>
                </Avatar>
                <span className="grid min-w-0">
                  <span className="block truncate font-medium">{user.name}</span>
                  <span className="block truncate font-normal text-muted-foreground text-xs">
                    {user.email}
                  </span>
                </span>
              </MenuGroupLabel>
            </MenuGroup>
            <MenuSeparator />
            <MenuGroup>
              <MenuLinkItem render={<Link to="/settings" />}>
                <HugeiconsIcon aria-hidden="true" icon={SettingsIcon} />
                Settings
              </MenuLinkItem>
            </MenuGroup>
            <MenuSeparator />
            <MenuGroup>
              <MenuItem onClick={() => void signOut()} variant="destructive">
                <HugeiconsIcon aria-hidden="true" icon={LogoutIcon} />
                Log out
              </MenuItem>
            </MenuGroup>
          </MenuPopup>
        </Menu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
