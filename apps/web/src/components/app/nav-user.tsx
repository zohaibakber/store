import { ComputerIcon, LogoutIcon, Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import { useTheme } from "@/components/theme/provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
import { signOut, useAuth } from "@/lib/auth";
import { initials } from "@/lib/format";

export function NavUser() {
  const auth = useAuth();
  const { preference, setTheme } = useTheme();
  const snapshot = auth.snapshot;

  if (snapshot?.status !== "authenticated") {
    return (
      <Button render={<Link to="/sign-in" />} size="sm" variant="outline">
        Sign in
      </Button>
    );
  }

  const { user } = snapshot;

  return (
    <Menu>
      <MenuTrigger render={<Button aria-label="Account menu" size="icon-sm" variant="ghost" />}>
        <Avatar className="size-7 rounded-lg">
          <AvatarImage alt={user.name} src={user.image ?? undefined} />
          <AvatarFallback className="rounded-lg text-xs">{initials(user.name)}</AvatarFallback>
        </Avatar>
      </MenuTrigger>
      <MenuPopup align="end" className="w-62" side="bottom">
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
                if (value === "system" || value === "light" || value === "dark") setTheme(value);
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
  );
}
