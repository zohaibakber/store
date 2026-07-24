import { Delete02Icon, FileAttachmentIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ThinkingOrb } from "thinking-orbs";

import { Button } from "@/components/ui/button";
import { Frame, FrameHeader } from "@/components/ui/frame";

import { fileDescription, useUpload } from "./context";

function UploadAttachmentList() {
  const {
    state: { files, phase },
    actions: { removeFile },
    meta: { processing },
  } = useUpload();

  if (files.length === 0 && !processing) return null;

  return (
    <div className="flex flex-col gap-2">
      {files.map((file) => (
        <Frame className="w-full" key={`${file.name}-${file.size}`}>
          <FrameHeader className="flex-row items-center gap-3 px-4 py-3">
            <HugeiconsIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
              icon={FileAttachmentIcon}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{file.name}</p>
              <p className="truncate text-xs text-muted-foreground">{fileDescription(file)}</p>
            </div>
            <Button
              aria-label={`Remove ${file.name}`}
              disabled={processing}
              onClick={() => removeFile(file)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon aria-hidden="true" icon={Delete02Icon} />
            </Button>
          </FrameHeader>
        </Frame>
      ))}

      {/* Neither step reports real progress, so an indeterminate orb is honest
          where a percentage bar was not. */}
      {processing && (
        <div
          aria-live="polite"
          className="mt-2 flex items-center gap-3 rounded-2xl border border-dashed px-4 py-3"
        >
          <ThinkingOrb size={20} state={phase === "syncing" ? "solving" : "searching"} />
          <div className="min-w-0">
            <p className="font-medium">
              {phase === "syncing" ? "Applying changes" : "Reading invoices with AI"}
            </p>
            <p className="text-xs text-muted-foreground">
              {phase === "syncing"
                ? "Writing the approved stock into the local database."
                : "Extracting products and quantities from the attached files."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export { UploadAttachmentList };
