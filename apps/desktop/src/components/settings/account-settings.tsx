import { Login01Icon, LogoutIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { initials } from "@store/services/format";
import { Link } from "@tanstack/react-router";

import { FrameCard } from "@/components/shared/frame-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { signOut, useAuth } from "@/lib/auth";

export function AccountSettings() {
  const auth = useAuth();
  const user = auth.snapshot?.status === "authenticated" ? auth.snapshot.user : undefined;

  if (!user) {
    return (
      <FrameCard title="Account">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Not signed in</p>
            <p className="text-xs text-muted-foreground">
              Local data stays on this device. Sign in to back it up and sync across devices.
            </p>
          </div>
          <Button className="shrink-0" render={<Link to="/sign-in" />} size="sm">
            <HugeiconsIcon aria-hidden="true" icon={Login01Icon} />
            Sign in
          </Button>
        </div>
      </FrameCard>
    );
  }

  return (
    <FrameCard title="Account">
      <div className="flex items-center gap-3">
        <Avatar className="size-9 shrink-0">
          <AvatarImage alt={user.name} src={user.image ?? undefined} />
          <AvatarFallback>{initials(user.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
        <Button
          className="shrink-0"
          onClick={() => void signOut()}
          size="sm"
          title="Local data stays on this device until another account signs in."
          variant="destructive-outline"
        >
          <HugeiconsIcon aria-hidden="true" icon={LogoutIcon} />
          Log out
        </Button>
      </div>
    </FrameCard>
  );
}
