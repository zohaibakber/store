import { Delete02Icon, FileAttachmentIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { Frame, FrameHeader } from "@/components/ui/frame";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { fileDescription, useUpload } from "./upload-context";

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
              <p className="truncate text-muted-foreground text-xs">{fileDescription(file)}</p>
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

      {processing && (
        <Progress className="mt-2" value={phase === "syncing" ? 75 : 45}>
          <ProgressLabel>
            {phase === "syncing" ? "Applying changes" : "Reading invoices with AI"}
          </ProgressLabel>
          <ProgressValue>{() => (phase === "syncing" ? "Applying" : "Analysing")}</ProgressValue>
        </Progress>
      )}
    </div>
  );
}

export { UploadAttachmentList };
