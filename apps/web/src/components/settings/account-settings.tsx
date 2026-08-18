import { LogoutIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { FrameCard } from "@/components/shared/frame-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useClerkSignOut } from "@/lib/clerk-workspace";
import { initials } from "@/lib/format";

export function AccountSettings() {
  const { snapshot } = useAuth();
  const clerkSignOut = useClerkSignOut();
  const user = snapshot?.user;

  return (
    <FrameCard description="The account signed in on this device." title="Account">
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <Avatar className="size-10">
            <AvatarImage alt={user?.name ?? ""} src={user?.image ?? undefined} />
            <AvatarFallback>{user ? initials(user.name) : "?"}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">{user?.name ?? "Not signed in"}</p>
            <p className="truncate text-sm text-muted-foreground">{user?.email ?? "—"}</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t pt-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Sign out</p>
            <p className="text-sm text-muted-foreground">
              Local data stays on this device until another account signs in.
            </p>
          </div>
          <Button
            className="shrink-0"
            disabled={!user}
            onClick={() => void clerkSignOut()}
            variant="destructive-outline"
          >
            <HugeiconsIcon aria-hidden="true" icon={LogoutIcon} />
            Log out
          </Button>
        </div>
      </div>
    </FrameCard>
  );
}
