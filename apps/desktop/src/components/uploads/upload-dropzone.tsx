import { useRef } from "react";
import { FileAttachmentIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useUpload } from "./upload-context";

function UploadDropzone() {
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    actions: { addFiles },
  } = useUpload();

  return (
    <>
      <input
        ref={inputRef}
        accept=".csv,application/pdf"
        className="sr-only"
        multiple
        onChange={(event) => event.target.files && addFiles(event.target.files)}
        type="file"
      />
      <button
        className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 p-4 text-center"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          addFiles(event.dataTransfer.files);
        }}
        type="button"
      >
        <HugeiconsIcon icon={FileAttachmentIcon} />
        <span className="font-medium">Drop invoices here or browse</span>
        <span className="text-xs text-muted-foreground">PDF and CSV files</span>
      </button>
    </>
  );
}

export { UploadDropzone };
