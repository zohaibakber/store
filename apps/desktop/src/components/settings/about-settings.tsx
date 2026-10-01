import { ReloadIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import { FrameCard } from "@/components/shared/frame-card";
import { Button } from "@/components/ui/button";
import { canCheckForAppUpdate, useCheckForAppUpdate } from "@/hooks/use-app-updater";
import { cn } from "@/lib/utils";

export function AboutSettings() {
  const [supportsUpdates] = useState(canCheckForAppUpdate);
  const checkForAppUpdate = useCheckForAppUpdate();

  return (
    <FrameCard>
      <dl className="flex flex-col divide-y text-sm">
        <div
          className={cn(
            "flex min-h-8 items-center justify-between gap-4",
            supportsUpdates && "pb-3",
          )}
        >
          <dt className="text-muted-foreground">Version</dt>
          <dd className="tabular-nums">v{__APP_VERSION__}</dd>
        </div>
        {supportsUpdates ? (
          <div className="flex items-center justify-between gap-4 pt-3">
            <div className="min-w-0">
              <dt>Updates</dt>
              <dd className="text-xs text-muted-foreground">
                Asks GitHub if a newer desktop build is out.
              </dd>
            </div>
            <Button className="shrink-0" onClick={checkForAppUpdate} size="sm" variant="outline">
              <HugeiconsIcon aria-hidden="true" icon={ReloadIcon} />
              Check for updates
            </Button>
          </div>
        ) : null}
      </dl>
    </FrameCard>
  );
}
