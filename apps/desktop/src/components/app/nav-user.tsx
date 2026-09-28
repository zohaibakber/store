import { Login01Icon, LogoutIcon, SettingsIcon, UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { initials } from "@store/services/format";
import { Link } from "@tanstack/react-router";

import { useTheme } from "@/components/theme/provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { signOut, useAuth } from "@/lib/auth";

function UserIdentity({
  image,
  name,
  detail,
}: {
  readonly image: string | null | undefined;
  readonly name: string;
  readonly detail: string;
}) {
  return (
    <>
      <Avatar className="size-8 shrink-0">
        <AvatarImage alt={name} src={image ?? undefined} />
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <span className="grid min-w-0 flex-1 text-left leading-tight">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      </span>
    </>
  );
}

export function NavUser() {
  const auth = useAuth();
  const { isMobile } = useSidebar();
  const { preference, setTheme } = useTheme();
  const snapshot = auth.snapshot;

  if (snapshot?.status !== "authenticated") {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton render={<Link to="/sign-in" />} tooltip="Sign in">
            <HugeiconsIcon icon={Login01Icon} />
            <span>Sign in</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  const { user } = snapshot;
  const organizationName = snapshot.activeOrganization?.name;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Menu>
          <MenuTrigger
            render={<SidebarMenuButton aria-label="Account menu" size="lg" tooltip={user.name} />}
          >
            <UserIdentity
              detail={organizationName ?? user.email}
              image={user.image}
              name={user.name}
            />
            <HugeiconsIcon
              aria-hidden="true"
              className="ms-auto size-4 text-muted-foreground"
              icon={UnfoldMoreIcon}
            />
          </MenuTrigger>
          <MenuPopup align="end" className="w-62" side={isMobile ? "top" : "right"}>
            <MenuGroup>
              <MenuGroupLabel>
                <span className="flex w-full items-center gap-2">
                  <UserIdentity detail={user.email} image={user.image} name={user.name} />
                </span>
              </MenuGroupLabel>
            </MenuGroup>
            <MenuSeparator />
            <MenuGroup>
              <MenuItem render={<Link to="/settings/account" />}>
                <HugeiconsIcon aria-hidden="true" icon={SettingsIcon} />
                Account settings
              </MenuItem>
            </MenuGroup>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Theme</MenuGroupLabel>
              <MenuRadioGroup
                aria-label="Theme"
                onValueChange={(value) => {
                  if (value === "system" || value === "light" || value === "dark") setTheme(value);
                }}
                value={preference}
              >
                <MenuRadioItem closeOnClick={false} value="system">
                  System
                </MenuRadioItem>
                <MenuRadioItem closeOnClick={false} value="light">
                  Light
                </MenuRadioItem>
                <MenuRadioItem closeOnClick={false} value="dark">
                  Dark
                </MenuRadioItem>
              </MenuRadioGroup>
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
