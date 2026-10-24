import { CloudDownloadIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useInventorySyncTransfer } from "@store/inventory-react";

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";

function FirstSyncProgress() {
  const transfer = useInventorySyncTransfer();
  if (transfer === undefined || transfer.partsTotal <= 0) {
    return <Spinner aria-label="Downloading" className="size-5" />;
  }
  const label = `Part ${Math.min(transfer.partsDone + 1, transfer.partsTotal)} of ${transfer.partsTotal}`;
  return (
    <EmptyContent>
      <Progress
        aria-label="Downloading"
        getAriaValueText={() => label}
        max={transfer.partsTotal}
        value={transfer.partsDone}
      />
      <span className="text-xs text-muted-foreground tabular-nums">{label}</span>
    </EmptyContent>
  );
}

export function FirstSync() {
  return (
    <Empty aria-busy="true">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon aria-hidden="true" icon={CloudDownloadIcon} />
        </EmptyMedia>
        <EmptyTitle>Downloading your inventory</EmptyTitle>
        <EmptyDescription>
          Products, stock and sales are saved on this device so the app keeps working offline.
        </EmptyDescription>
      </EmptyHeader>
      <FirstSyncProgress />
    </Empty>
  );
}
