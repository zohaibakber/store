import { CheckmarkCircle02Icon, FileAttachmentIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { AsyncBoundary } from "@/components/app/error-boundary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Frame, FrameHeader } from "@/components/ui/frame";
import { formatCount, formatNumber } from "@/lib/format";

import { useUpload } from "./context";
import { UploadImportCategoryField } from "./import-category-field";
import { UploadOrderMatch } from "./order-match";

function UploadProposedChanges() {
  const {
    state: { changes },
    actions: { applyChanges },
    meta: { processing },
  } = useUpload();

  if (changes.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            Proposed changes{" "}
            <span className="text-muted-foreground tabular-nums">
              {formatNumber(changes.length)}
            </span>
          </p>
          <p className="text-sm text-muted-foreground">
            Nothing changes in your store until you apply this review.
          </p>
        </div>
        <Button disabled={processing} onClick={() => void applyChanges()} size="sm" type="button">
          <HugeiconsIcon aria-hidden="true" icon={CheckmarkCircle02Icon} />
          Apply {formatCount(changes.length, "change")}
        </Button>
      </div>

      {changes.some((change) => change.type === "create_product") ? (
        <UploadImportCategoryField />
      ) : null}

      <AsyncBoundary fallback={null}>
        <UploadOrderMatch />
      </AsyncBoundary>

      <div className="flex flex-col gap-2">
        {changes.map((change, index) => {
          const isNew = change.type === "create_product";
          return (
            <Frame className="w-full" key={`${change.name}-${index}`}>
              <FrameHeader className="flex-row items-center">
                <HugeiconsIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                  icon={isNew ? FileAttachmentIcon : CheckmarkCircle02Icon}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{change.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatCount(change.packQuantity, "pack")} ·{" "}
                    {formatCount(change.unitQuantity, "unit")}
                    {change.batchNumber ? ` · Batch ${change.batchNumber}` : ""}
                  </p>
                </div>
                <Badge className="shrink-0" variant={isNew ? "default" : "secondary"}>
                  {isNew ? "New product" : "Inventory update"}
                </Badge>
              </FrameHeader>
            </Frame>
          );
        })}
      </div>
    </div>
  );
}

export { UploadProposedChanges };
