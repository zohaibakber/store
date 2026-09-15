import { LogoutIcon } from "@hugeicons/core-free-icons";
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
  MenuRadioGroup,
  MenuRadioItem,
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
        <Avatar className="size-7">
          <AvatarImage alt={user.name} src={user.image ?? undefined} />
          <AvatarFallback>{initials(user.name)}</AvatarFallback>
        </Avatar>
      </MenuTrigger>
      <MenuPopup align="end" className="w-62" side="bottom">
        <MenuGroup>
          <MenuGroupLabel className="flex w-full items-center">
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
  );
}
