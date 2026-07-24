import {
  ArrowDown01Icon,
  ComputerIcon,
  LogoutIcon,
  Moon02Icon,
  Sun03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useTheme } from "@/components/theme-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuPrimitive,
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
  const { preference, setTheme } = useTheme();
  if (!snapshot?.activeOrganization || !snapshot.user) return null;
  const { activeOrganization, user } = snapshot;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Menu>
          <MenuTrigger
            render={
              <SidebarMenuButton className="w-fit aria-expanded:bg-muted aria-expanded:text-foreground" />
            }
          >
            {/* vite-plugin-electron builds with base: "./" so the packaged app
                can load index.html via file://; a root-absolute "/logo.svg"
                would resolve to the filesystem root instead of the public dir. */}
            <img
              alt="Logo"
              className="size-6 shrink-0 rounded-[5px]"
              src={`${import.meta.env.BASE_URL}logo.svg`}
            />
            <span className="min-w-0 flex-1 truncate text-left font-medium">
              {activeOrganization.name}
            </span>
            <HugeiconsIcon aria-hidden="true" className="ml-auto size-4" icon={ArrowDown01Icon} />
          </MenuTrigger>
          <MenuPopup align="center" className="w-62" side="bottom">
            <MenuGroup>
              <MenuGroupLabel className="flex w-full items-center gap-2">
                <Avatar className="size-6 shrink-0">
                  <AvatarImage alt={user.name} src={user.image ?? undefined} />
                  <AvatarFallback>{initials(user.name)}</AvatarFallback>
                </Avatar>
                <span className="grid min-w-0">
                  <span className="block truncate font-medium">{user.name}</span>
                  <span className="block truncate text-xs font-normal text-muted-foreground">
                    {user.email}
                  </span>
                </span>
              </MenuGroupLabel>
            </MenuGroup>
            <MenuSeparator />
            <MenuGroup>
              <div className="flex min-h-8 items-center justify-between gap-4 px-2 py-1 text-sm">
                <span>Theme</span>
                <MenuPrimitive.RadioGroup
                  aria-label="Theme"
                  className="grid w-fit shrink-0 grid-cols-3 rounded-lg border bg-muted/40 p-0.5"
                  onValueChange={(value) => {
                    if (value === "system" || value === "light" || value === "dark")
                      setTheme(value);
                  }}
                  value={preference}
                >
                  <MenuPrimitive.RadioItem
                    aria-label="Use system theme"
                    className="flex size-6 cursor-default items-center justify-center rounded-md text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring data-highlighted:bg-accent data-checked:bg-background data-checked:text-foreground data-checked:shadow-xs"
                    closeOnClick={false}
                    value="system"
                  >
                    <HugeiconsIcon aria-hidden="true" className="size-4" icon={ComputerIcon} />
                  </MenuPrimitive.RadioItem>
                  <MenuPrimitive.RadioItem
                    aria-label="Use light theme"
                    className="flex size-6 cursor-default items-center justify-center rounded-md text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring data-highlighted:bg-accent data-checked:bg-background data-checked:text-foreground data-checked:shadow-xs"
                    closeOnClick={false}
                    value="light"
                  >
                    <HugeiconsIcon aria-hidden="true" className="size-4" icon={Sun03Icon} />
                  </MenuPrimitive.RadioItem>
                  <MenuPrimitive.RadioItem
                    aria-label="Use dark theme"
                    className="flex size-6 cursor-default items-center justify-center rounded-md text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring data-highlighted:bg-accent data-checked:bg-background data-checked:text-foreground data-checked:shadow-xs"
                    closeOnClick={false}
                    value="dark"
                  >
                    <HugeiconsIcon aria-hidden="true" className="size-4" icon={Moon02Icon} />
                  </MenuPrimitive.RadioItem>
                </MenuPrimitive.RadioGroup>
              </div>
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
