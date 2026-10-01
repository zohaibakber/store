import { ComputerIcon, Login01Icon, LogoutIcon, SettingsIcon } from "@hugeicons/core-free-icons";
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
import type { Workspace } from "@/host-access";
import { signOut, useAuth } from "@/lib/auth";
import { OnDeviceRetry, OnDeviceStatus, SidebarSyncButton } from "@/lib/inventory/sync-status";

type Identity = {
  readonly name: string;
  readonly detail: string;
  readonly avatar: React.ReactNode;
};

const DEVICE_IDENTITY: Identity = {
  name: "This device",
  detail: "No account",
  avatar: (
    <AvatarFallback>
      <HugeiconsIcon aria-hidden="true" className="size-4" icon={ComputerIcon} />
    </AvatarFallback>
  ),
};

const accountIdentity = (user: {
  readonly name: string;
  readonly email: string;
  readonly image?: string | null;
}): Identity => ({
  name: user.name,
  detail: user.email,
  avatar: (
    <>
      <AvatarImage alt={user.name} src={user.image ?? undefined} />
      <AvatarFallback>{initials(user.name)}</AvatarFallback>
    </>
  ),
});

function IdentityRow({
  identity,
  detail,
}: {
  readonly identity: Identity;
  readonly detail: React.ReactNode;
}) {
  return (
    <>
      <Avatar className="size-8 shrink-0">{identity.avatar}</Avatar>
      <span className="grid min-w-0 flex-1 text-left leading-tight">
        <span className="truncate text-sm font-medium">{identity.name}</span>
        {detail}
      </span>
    </>
  );
}

type SyncSlots = {
  readonly status: React.ReactNode;
  readonly action: React.ReactNode;
};

const syncOf = (workspace: Workspace): SyncSlots => {
  switch (workspace._tag) {
    case "Local":
      return { status: <OnDeviceStatus />, action: <OnDeviceRetry /> };
    case "Organization":
      return { status: null, action: <SidebarSyncButton /> };
    case "None":
      return { status: null, action: null };
  }
};

function ThemeGroup() {
  const { preference, setTheme } = useTheme();
  return (
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
  );
}

export function NavUser() {
  const { snapshot, workspace } = useAuth();
  const { isMobile } = useSidebar();
  const signedIn = snapshot?.status === "authenticated";
  const identity = signedIn ? accountIdentity(snapshot.user) : DEVICE_IDENTITY;
  const sync = syncOf(workspace);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Menu>
          <MenuTrigger
            render={
              <SidebarMenuButton aria-label="Account menu" size="lg" tooltip={identity.name} />
            }
          >
            <IdentityRow detail={sync.status} identity={identity} />
          </MenuTrigger>
          {sync.action}
          <MenuPopup align="end" className="w-62" side={isMobile ? "top" : "right"}>
            <MenuGroup>
              <MenuGroupLabel>
                <span className="flex w-full items-center gap-2">
                  <IdentityRow
                    detail={
                      <span className="truncate text-xs text-muted-foreground">
                        {identity.detail}
                      </span>
                    }
                    identity={identity}
                  />
                </span>
              </MenuGroupLabel>
            </MenuGroup>
            <MenuSeparator />
            <MenuGroup>
              {signedIn ? (
                <MenuItem render={<Link to="/settings/account" />}>
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
                  <MenuItem onClick={() => void signOut()} variant="destructive">
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
