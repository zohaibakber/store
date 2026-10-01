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
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import type { Workspace } from "@/host-access";
import { signOut, useAuth } from "@/lib/auth";
import { OnDeviceAction, OnDeviceStatus, SidebarSyncButton } from "@/lib/inventory/sync-status";
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
  mark: (
    <span className="flex size-4 shrink-0 items-center justify-center group-data-[collapsible=icon]:size-8">
      <HugeiconsIcon aria-hidden="true" className="size-4" icon={ComputerIcon} />
    </span>
  ),
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
  const avatar = (
    <Avatar className="size-8 shrink-0">
      <AvatarImage alt={user.name} src={user.image ?? undefined} />
      <AvatarFallback>{initials(user.name)}</AvatarFallback>
    </Avatar>
  );
  return { name: user.name, detail: user.email, mark: avatar, avatar };
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

type SyncSlots = {
  readonly status: React.ReactNode;
  readonly action: React.ReactNode;
};

const syncOf = (workspace: Workspace): SyncSlots => {
  switch (workspace._tag) {
    case "Local":
      return { status: <OnDeviceStatus />, action: <OnDeviceAction /> };
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
  const moving = usePublishInProgress();
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
            <IdentityRow detail={sync.status} mark={identity.mark} name={identity.name} />
          </MenuTrigger>
          {sync.action}
          <MenuPopup align="start" className="w-(--anchor-width) min-w-56!" side="top">
            <MenuGroup>
              <MenuGroupLabel>
                <span className="flex w-full items-center gap-2">
                  <IdentityRow
                    detail={
                      <span className="truncate text-xs text-muted-foreground">
                        {identity.detail}
                      </span>
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
                <MenuItem render={<Link to="/settings" />}>
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
