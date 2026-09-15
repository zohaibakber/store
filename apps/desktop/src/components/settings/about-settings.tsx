import { ReloadIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import { FrameCard } from "@/components/shared/frame-card";
import { Button } from "@/components/ui/button";
import { canCheckForAppUpdate, checkForAppUpdate } from "@/hooks/use-app-updater";

export function AboutSettings() {
  const [supportsUpdates] = useState(canCheckForAppUpdate);

  return (
    <FrameCard title="About Tabaaq">
      <div className="flex flex-col gap-4">
        <dl className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">Version</dt>
          <dd className="font-mono tabular-nums">v{__APP_VERSION__}</dd>
        </dl>
        {supportsUpdates ? (
          <div className="flex items-center justify-between gap-4 border-t pt-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Updates</p>
              <p className="text-sm text-muted-foreground">
                Asks GitHub if a newer desktop build is out.
              </p>
            </div>
            <Button className="shrink-0" onClick={checkForAppUpdate} variant="outline">
              <HugeiconsIcon aria-hidden="true" icon={ReloadIcon} />
              Check for updates
            </Button>
          </div>
        ) : null}
      </div>
    </FrameCard>
  );
}
