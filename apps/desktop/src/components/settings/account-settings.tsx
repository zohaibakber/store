import { Login01Icon, LogoutIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import { FrameCard } from "@/components/shared/frame-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { signOut, useAuth } from "@/lib/auth";
import { initials } from "@/lib/format";

export function AccountSettings() {
  const auth = useAuth();
  const user = auth.snapshot?.status === "authenticated" ? auth.snapshot.user : undefined;

  if (!user) {
    return (
      <FrameCard description="Sign in when you want to sync this device." title="Account">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Not signed in</p>
            <p className="text-sm text-muted-foreground">
              Local data stays on this device. Sign in to back it up and sync across devices.
            </p>
          </div>
          <Button className="shrink-0" render={<Link to="/sign-in" />}>
            <HugeiconsIcon aria-hidden="true" icon={Login01Icon} />
            Sign in
          </Button>
        </div>
      </FrameCard>
    );
  }

  return (
    <FrameCard description="The account signed in on this device." title="Account">
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <Avatar className="size-10">
            <AvatarImage alt={user.name} src={user.image ?? undefined} />
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">{user.name}</p>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t pt-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Sign out</p>
            <p className="text-sm text-muted-foreground">
              Local data stays on this device until another account signs in.
            </p>
          </div>
          <Button className="shrink-0" onClick={() => void signOut()} variant="destructive-outline">
            <HugeiconsIcon aria-hidden="true" icon={LogoutIcon} />
            Log out
          </Button>
        </div>
      </div>
    </FrameCard>
  );
}
