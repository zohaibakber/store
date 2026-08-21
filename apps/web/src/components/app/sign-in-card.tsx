import { CloudIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth";

export function SignInCard() {
  const auth = useAuth();
  if (auth.snapshot?.status === "authenticated") return null;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Link
          className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-3 text-left transition-colors group-data-[collapsible=icon]:hidden hover:bg-muted"
          to="/sign-in"
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <HugeiconsIcon aria-hidden="true" className="size-4 shrink-0" icon={CloudIcon} />
            Sign in to sync
          </span>
          <span className="text-xs text-muted-foreground">
            Your data is saved on this device. Sign in to back it up and sync across devices.
          </span>
        </Link>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
