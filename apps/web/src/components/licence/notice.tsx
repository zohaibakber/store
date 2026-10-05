import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { permits } from "@store/contracts";
import { useLicenceState, useStaffState } from "@store/inventory-react";
import { useState } from "react";

import { licenceNoticeCopy, RENEW_LICENCE } from "@/components/licence/copy";
import { LicenceDialog } from "@/components/licence/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function LicenceNotice() {
  const state = useLicenceState();
  const staff = useStaffState();
  const [renewing, setRenewing] = useState(false);

  const message = state === undefined ? undefined : licenceNoticeCopy(state);
  const ended = state?._tag === "expired";
  const mayManage = staff !== undefined && permits(staff, "manageShop");
  const shown = message !== undefined && (ended || mayManage);

  return (
    <>
      {shown ? (
        <div
          className="flex shrink-0 items-center gap-3 border-b bg-muted px-4 py-1.5 text-sm"
          data-state={state?._tag}
          data-testid="licence-notice"
          role="status"
        >
          <HugeiconsIcon
            aria-hidden="true"
            className={cn("size-4 shrink-0", ended ? "text-destructive" : "text-warning")}
            icon={Alert02Icon}
          />
          <p className="min-w-0 flex-1">{message}</p>
          <Button
            className="shrink-0"
            onClick={() => setRenewing(true)}
            size="xs"
            type="button"
            variant="outline"
          >
            {RENEW_LICENCE}
          </Button>
        </div>
      ) : null}
      {renewing ? <LicenceDialog onClose={() => setRenewing(false)} /> : null}
    </>
  );
}
