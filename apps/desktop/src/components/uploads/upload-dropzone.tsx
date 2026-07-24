import { useRef, useState } from "react";
import { Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";
import { useUpload } from "./upload-context";

function UploadDropzone() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const {
    actions: { addFiles },
    meta: { processing },
  } = useUpload();

  return (
    <>
      <input
        accept=".csv,application/pdf"
        className="sr-only"
        multiple
        onChange={(event) => event.target.files && addFiles(event.target.files)}
        ref={inputRef}
        type="file"
      />
      <button
        className={cn(
          "flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed bg-muted/40 p-6 text-center transition-colors",
          "hover:border-ring hover:bg-muted/72 disabled:pointer-events-none disabled:opacity-64",
          isDragging && "border-ring bg-muted/72",
        )}
        disabled={processing}
        onClick={() => inputRef.current?.click()}
        onDragLeave={() => setIsDragging(false)}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          addFiles(event.dataTransfer.files);
        }}
        type="button"
      >
        <HugeiconsIcon
          aria-hidden="true"
          className="size-5 text-muted-foreground"
          icon={Upload01Icon}
        />
        <span className="font-medium">Drop invoices here, or browse</span>
        <span className="text-muted-foreground text-xs">PDF and CSV files</span>
      </button>
    </>
  );
}

export { UploadDropzone };
