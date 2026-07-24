import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Menu,
  MenuPopup,
  MenuGroup,
  MenuItem,
  MenuGroupLabel,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { HugeiconsIcon } from "@hugeicons/react";
import { LogoutIcon, Moon02Icon, Sun02Icon, UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { useTheme } from "@/components/theme-provider";
import { getErrorMessage, useAuth, type AuthSnapshot } from "@/lib/auth";
import { toast } from "@/lib/toast";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

export function NavUser() {
  const { isMobile } = useSidebar();
  const { theme, setTheme } = useTheme();
  const { snapshot } = useAuth();
  if (!snapshot?.user) return null;
  const { user } = snapshot;

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
        <Menu>
          <MenuTrigger
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
              <span className="truncate text-xs">{user.email}</span>
            </div>
            <HugeiconsIcon icon={UnfoldMoreIcon} className="ml-auto" />
          </MenuTrigger>
          <MenuPopup
            className="min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "top"}
            align="end"
            sideOffset={4}
          >
            <MenuGroup>
              <MenuGroupLabel>
                <span className="block truncate font-medium">{user.name}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {user.email}
                </span>
              </MenuGroupLabel>
            </MenuGroup>
            <MenuSeparator />
            <MenuGroup>
              <MenuItem
                closeOnClick={false}
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                <HugeiconsIcon icon={theme === "dark" ? Sun02Icon : Moon02Icon} />
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </MenuItem>
            </MenuGroup>
            <MenuSeparator />
            <MenuGroup>
              <MenuItem onClick={() => void signOut()} variant="destructive">
                <HugeiconsIcon icon={LogoutIcon} />
                Log out
              </MenuItem>
            </MenuGroup>
          </MenuPopup>
        </Menu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
