import { Delete02Icon, FileAttachmentIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { fileDescription, useUpload } from "./upload-context";

function UploadAttachmentList() {
  const {
    state: { files, phase },
    actions: { removeFile },
    meta: { processing },
  } = useUpload();

  return (
    <>
      {files.length > 0 && (
        <AttachmentGroup>
          {files.map((file) => (
            <Attachment
              key={`${file.name}-${file.size}`}
              state={processing ? "processing" : "done"}
            >
              <AttachmentMedia>
                <HugeiconsIcon icon={FileAttachmentIcon} />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{file.name}</AttachmentTitle>
                <AttachmentDescription>{fileDescription(file)}</AttachmentDescription>
              </AttachmentContent>
              <AttachmentActions>
                <AttachmentAction
                  aria-label={`Remove ${file.name}`}
                  disabled={processing}
                  onClick={() => removeFile(file)}
                >
                  <HugeiconsIcon icon={Delete02Icon} />
                </AttachmentAction>
              </AttachmentActions>
            </Attachment>
          ))}
        </AttachmentGroup>
      )}
      {processing && (
        <Progress value={phase === "syncing" ? 75 : 45}>
          <ProgressLabel>
            {phase === "syncing" ? "Applying changes" : "Reading invoices with AI"}
          </ProgressLabel>
          <ProgressValue>{() => (phase === "syncing" ? "Applying" : "Analysing")}</ProgressValue>
        </Progress>
      )}
    </>
  );
}

export { UploadAttachmentList };
