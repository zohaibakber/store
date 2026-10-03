import {
  ComputerIcon,
  Login01Icon,
  LogoutIcon,
  Moon02Icon,
  SettingsIcon,
  Sun03Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { initials } from "@store/services/format";
import { Link } from "@tanstack/react-router";
import type * as React from "react";

import { useTheme } from "@/components/theme/provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { signOut, useAuth } from "@/lib/auth";
import { OnDeviceStatus } from "@/lib/inventory/sync-status";
import { usePublishInProgress } from "@/lib/local-publish";

type Identity = {
  readonly name: string;
  readonly detail: string;
  readonly mark: React.ReactNode;
  readonly avatar: React.ReactNode;
};

const DEVICE_IDENTITY: Identity = {
  name: "This device",
  detail: "No account",
  mark: <HugeiconsIcon aria-hidden="true" icon={ComputerIcon} />,
  avatar: (
    <Avatar className="size-8 shrink-0">
      <AvatarFallback>
        <HugeiconsIcon aria-hidden="true" className="size-4" icon={ComputerIcon} />
      </AvatarFallback>
    </Avatar>
  ),
};

const accountIdentity = (user: {
  readonly name: string;
  readonly email: string;
  readonly image?: string | null;
}): Identity => {
  const face = (
    <>
      <AvatarImage alt={user.name} src={user.image ?? undefined} />
      <AvatarFallback>{initials(user.name)}</AvatarFallback>
    </>
  );
  return {
    name: user.name,
    detail: user.email,
    mark: <Avatar className="-mx-0.5 size-5 shrink-0">{face}</Avatar>,
    avatar: <Avatar className="size-8 shrink-0">{face}</Avatar>,
  };
};

function IdentityRow({
  mark,
  name,
  detail,
}: {
  readonly mark: React.ReactNode;
  readonly name: string;
  readonly detail: React.ReactNode;
}) {
  return (
    <>
      {mark}
      <span className="grid min-w-0 flex-1 text-left leading-tight">
        <span className="truncate text-sm font-medium">{name}</span>
        {detail}
      </span>
    </>
  );
}

const THEMES = [
  { value: "system", label: "System", icon: ComputerIcon },
  { value: "light", label: "Light", icon: Sun03Icon },
  { value: "dark", label: "Dark", icon: Moon02Icon },
] as const;

function ThemeGroup() {
  const { preference, setTheme } = useTheme();
  return (
    <MenuGroup>
      <MenuGroupLabel>Theme</MenuGroupLabel>
      {THEMES.map((theme) => (
        <MenuItem
          aria-checked={preference === theme.value}
          closeOnClick={false}
          key={theme.value}
          onClick={() => setTheme(theme.value)}
          role="menuitemradio"
        >
          <HugeiconsIcon aria-hidden="true" icon={theme.icon} />
          {theme.label}
          {preference === theme.value ? (
            <span className="ms-auto inline-flex">
              <HugeiconsIcon aria-hidden="true" className="size-4" icon={Tick02Icon} />
            </span>
          ) : null}
        </MenuItem>
      ))}
    </MenuGroup>
  );
}

export function NavUser() {
  const { snapshot, workspace } = useAuth();
  const moving = usePublishInProgress();
  const signedIn = snapshot?.status === "authenticated";
  const identity = signedIn ? accountIdentity(snapshot.user) : DEVICE_IDENTITY;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Menu>
          <MenuTrigger
            render={<SidebarMenuButton aria-label="Account menu" tooltip={identity.name} />}
          >
            {identity.mark}
            <span>{identity.name}</span>
          </MenuTrigger>
          <MenuPopup align="start" className="w-(--anchor-width) min-w-56!" side="top">
            <MenuGroup>
              <MenuGroupLabel>
                <span className="flex w-full items-center gap-2">
                  <IdentityRow
                    detail={
                      workspace._tag === "Local" ? (
                        <OnDeviceStatus />
                      ) : (
                        <span className="truncate text-xs text-muted-foreground">
                          {identity.detail}
                        </span>
                      )
                    }
                    mark={identity.avatar}
                    name={identity.name}
                  />
                </span>
              </MenuGroupLabel>
            </MenuGroup>
            <MenuSeparator />
            <MenuGroup>
              {signedIn ? (
                <MenuItem render={<Link params={{ section: "account" }} to="/settings/$section" />}>
                  <HugeiconsIcon aria-hidden="true" icon={SettingsIcon} />
                  Account settings
                </MenuItem>
              ) : (
                <MenuItem render={<Link to="/sign-in" />}>
                  <HugeiconsIcon aria-hidden="true" icon={Login01Icon} />
                  Sign in to sync
                </MenuItem>
              )}
            </MenuGroup>
            <MenuSeparator />
            <ThemeGroup />
            {signedIn ? (
              <>
                <MenuSeparator />
                <MenuGroup>
                  <MenuItem disabled={moving} onClick={() => void signOut()} variant="destructive">
                    <HugeiconsIcon aria-hidden="true" icon={LogoutIcon} />
                    Log out
                  </MenuItem>
                </MenuGroup>
              </>
            ) : null}
          </MenuPopup>
        </Menu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
