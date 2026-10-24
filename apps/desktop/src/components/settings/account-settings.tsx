import { Login01Icon, LogoutIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { initials } from "@store/services/format";
import { Link } from "@tanstack/react-router";

import { FrameCard } from "@/components/shared/frame-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { signOut, useAuth } from "@/lib/auth";
import { usePublishInProgress } from "@/lib/local-publish";

function SignInToSync() {
  return (
    <FrameCard title="Account">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">This device</p>
          <p className="text-xs text-muted-foreground">
            Products, stock and sales are saved on this device only. Sign in to sync them across
            devices and work with your team.
          </p>
        </div>
        <Button className="shrink-0" render={<Link to="/sign-in" />} size="sm">
          <HugeiconsIcon aria-hidden="true" icon={Login01Icon} />
          Sign in to sync
        </Button>
      </div>
    </FrameCard>
  );
}

export function AccountSettings() {
  const auth = useAuth();
  const moving = usePublishInProgress();
  const user = auth.snapshot?.status === "authenticated" ? auth.snapshot.user : undefined;

  if (!user) return <SignInToSync />;

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
          disabled={moving}
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
