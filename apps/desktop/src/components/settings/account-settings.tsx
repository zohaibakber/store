import { LogoutIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { FrameCard } from "@/components/frame-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getErrorMessage, useAuth, type AuthSnapshot } from "@/lib/auth";
import { toast } from "@/lib/toast";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

async function signOut() {
  try {
    await window.auth?.signOut();
    window.dispatchEvent(
      new CustomEvent<AuthSnapshot>("auth:session", {
        detail: {
          status: "unauthenticated",
          user: null,
          activeOrganization: null,
          organizations: [],
          isOnline: navigator.onLine,
        },
      }),
    );
  } catch (error) {
    toast.error(getErrorMessage(error));
  }
}

export function AccountSettings() {
  const { snapshot } = useAuth();
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
            <p className="truncate text-muted-foreground text-sm">{user?.email ?? "—"}</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t pt-4">
          <div className="min-w-0">
            <p className="font-medium text-sm">Sign out</p>
            <p className="text-muted-foreground text-sm">
              Local data stays on this device until another account signs in.
            </p>
          </div>
          <Button
            className="shrink-0"
            disabled={!user}
            onClick={() => void signOut()}
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
