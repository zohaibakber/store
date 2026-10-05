import {
  ComputerIcon,
  LockIcon,
  Moon02Icon,
  Sun03Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { StaffMember } from "@store/contracts";
import { useStaffActions } from "@store/inventory-react";
import { initials } from "@store/services/format";
import type * as React from "react";

import { staffFailure, staffRoleLabel, useStaffAccess } from "@/components/staff/access";
import { useTheme } from "@/components/theme/provider";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "@/components/ui/menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { toastManager } from "@/components/ui/toast";
import { useWindowKeydown } from "@/lib/shortcuts";

type Identity = {
  readonly name: string;
  readonly detail: React.ReactNode;
  readonly mark: React.ReactNode;
  readonly avatar: React.ReactNode;
};

const staffIdentity = (member: StaffMember): Identity => {
  const face = <AvatarFallback>{initials(member.name)}</AvatarFallback>;
  return {
    name: member.name,
    detail: (
      <span className="truncate text-xs text-muted-foreground">{staffRoleLabel(member.role)}</span>
    ),
    mark: <Avatar className="-mx-0.5 size-5 shrink-0">{face}</Avatar>,
    avatar: <Avatar className="size-8 shrink-0">{face}</Avatar>,
  };
};

const useLock = () => {
  const { lock } = useStaffActions();
  return () => {
    lock().catch((cause: unknown) =>
      toastManager.add({ title: staffFailure(cause).message, type: "error" }),
    );
  };
};

const isLockChord = (event: KeyboardEvent) =>
  (event.key === "l" || event.key === "L") &&
  (event.ctrlKey || event.metaKey) &&
  !event.altKey &&
  !event.shiftKey;

function LockShortcut() {
  const lock = useLock();
  useWindowKeydown((event) => {
    if (!isLockChord(event)) return;
    event.preventDefault();
    if (!event.repeat) lock();
  }, true);
  return null;
}

function LockGroup() {
  const lock = useLock();
  return (
    <MenuGroup>
      <MenuItem aria-keyshortcuts="Control+L" onClick={lock}>
        <HugeiconsIcon aria-hidden="true" icon={LockIcon} />
        Lock
        <MenuShortcut>Ctrl+L</MenuShortcut>
      </MenuItem>
    </MenuGroup>
  );
}

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
  const staff = useStaffAccess();
  if (staff._tag !== "unlocked") return null;
  const identity = staffIdentity(staff.actor);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <LockShortcut />
        <Menu>
          <MenuTrigger
            render={<SidebarMenuButton aria-label="User menu" tooltip={identity.name} />}
          >
            {identity.mark}
            <span>{identity.name}</span>
          </MenuTrigger>
          <MenuPopup align="start" className="w-(--anchor-width) min-w-56!" side="top">
            <MenuGroup>
              <MenuGroupLabel>
                <span className="flex w-full items-center gap-2">
                  <IdentityRow
                    detail={identity.detail}
                    mark={identity.avatar}
                    name={identity.name}
                  />
                </span>
              </MenuGroupLabel>
            </MenuGroup>
            <MenuSeparator />
            <LockGroup />
            <MenuSeparator />
            <ThemeGroup />
          </MenuPopup>
        </Menu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
