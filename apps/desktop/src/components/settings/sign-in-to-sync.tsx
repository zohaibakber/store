import { Login01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import { FrameCard } from "@/components/shared/frame-card";
import { Button } from "@/components/ui/button";

export function SignInToSync() {
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
