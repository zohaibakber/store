import { CloudDownloadIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";

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
      <Spinner aria-label="Downloading" className="size-5" />
    </Empty>
  );
}
