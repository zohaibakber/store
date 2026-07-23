import { createContext, use, useState, type ReactNode } from "react";
import type { Category, InvoiceExtractionLine, Product } from "@store/contracts";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { useOnline } from "@/hooks/use-online";
import { parseExpiryDate } from "@/lib/format";

type ExtractedLine = InvoiceExtractionLine;
type ProposedChange = ExtractedLine & {
  type: "create_product" | "add_inventory";
  productId?: string;
};
type UploadPhase = "idle" | "processing" | "ready" | "syncing";

interface UploadState {
  files: File[];
  phase: UploadPhase;
  changes: ProposedChange[];
}

interface UploadActions {
  addFiles: (incoming: FileList | File[]) => void;
  removeFile: (file: File) => void;
  analyse: () => Promise<void>;
  applyChanges: () => Promise<void>;
}

interface UploadMeta {
  processing: boolean;
  isOnline: boolean;
}

interface UploadContextValue {
  state: UploadState;
  actions: UploadActions;
  meta: UploadMeta;
}

const UploadContext = createContext<UploadContextValue | null>(null);

const fileDescription = (file: File) => {
  const kind = file.type === "application/pdf" ? "PDF" : "CSV";
  return `${kind} · ${Math.max(1, Math.ceil(file.size / 1024))} KB`;
};

const isInvoice = (file: File) => /\.(csv|pdf)$/i.test(file.name);

const sameProduct = (line: ExtractedLine, product: Product) =>
  product.name.trim().toLocaleLowerCase() === line.name.trim().toLocaleLowerCase();

function UploadProvider({
  children,
  products,
  categories,
}: {
  children: ReactNode;
  products: readonly Product[];
  categories: readonly Category[];
}) {
  const router = useRouter();
  const isOnline = useOnline();
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [changes, setChanges] = useState<ProposedChange[]>([]);

  const addFiles = (incoming: FileList | File[]) => {
    const valid = Array.from(incoming).filter(isInvoice);
    if (valid.length !== Array.from(incoming).length)
      toast.error("Only PDF and CSV invoice files can be uploaded.");
    setFiles((current) =>
      [...current, ...valid].filter(
        (file, index, list) =>
          list.findIndex(
            (candidate) => candidate.name === file.name && candidate.size === file.size,
          ) === index,
      ),
    );
  };

  const removeFile = (file: File) => {
    setFiles((current) => current.filter((candidate) => candidate !== file));
  };

  const analyse = async () => {
    if (!isOnline) {
      toast.error("You’re offline. Connect to the internet before analysing invoices.");
      return;
    }
    if (!files.length) {
      toast.error("Add at least one invoice first.");
      return;
    }
    setPhase("processing");
    try {
      if (!window.serverApi) throw new Error("The authenticated server bridge is unavailable.");
      const payload = await window.serverApi.analyseInvoices({
        files: await Promise.all(
          files.map(async (file) => ({
            name: file.name,
            type: file.type,
            bytes: await file.arrayBuffer(),
          })),
        ),
      });
      setChanges(
        payload.lines.map((line) => {
          const product = products.find((candidate) => sameProduct(line, candidate));
          return product
            ? { ...line, type: "add_inventory", productId: product.id }
            : { ...line, type: "create_product" };
        }),
      );
      setPhase("ready");
      toast.success("Invoice analysis complete. Review the proposed changes.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not analyse invoices.");
      setPhase("idle");
    }
  };

  const applyChanges = async () => {
    if (!isOnline) {
      toast.error("You’re offline. Changes remain ready to apply when you reconnect.");
      return;
    }
    setPhase("syncing");
    try {
      const generalCategory =
        categories.find((category) => category.id === "general") ?? categories[0];
      if (!generalCategory) throw new Error("Create a category before importing inventory.");
      await window.offlineStore.importInventory({
        categoryId: generalCategory.id,
        lines: changes.map((change) => ({
          name: change.name,
          batchNumber: change.batchNumber,
          expiresAt: parseExpiryDate(change.expiresAt),
          unitsPerPack: change.unitsPerPack,
          packQuantity: change.packQuantity,
          unitQuantity: change.unitQuantity,
          packPrice: change.packPrice,
          productId: change.productId ?? null,
        })),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not apply changes.");
      setPhase("ready");
      return;
    }

    setChanges([]);
    setFiles([]);
    toast.success(`${changes.length} inventory changes applied locally.`);
    try {
      await router.invalidate();
    } catch {
      toast.warning("Inventory imported, but the current view could not be refreshed.");
    }
    try {
      const syncStatus = await window.offlineStore.sync();
      if (syncStatus.phase === "error")
        toast.warning("Inventory imported locally; synchronization will retry automatically.");
    } catch {
      toast.warning("Inventory imported locally; synchronization will retry automatically.");
    }
    setPhase("idle");
  };

  const processing = phase === "processing" || phase === "syncing";

  return (
    <UploadContext
      value={{
        state: { files, phase, changes },
        actions: { addFiles, removeFile, analyse, applyChanges },
        meta: { processing, isOnline },
      }}
    >
      {children}
    </UploadContext>
  );
}

function useUpload() {
  const context = use(UploadContext);
  if (!context) throw new Error("Upload components must be used within their provider.");
  return context;
}

export {
  UploadProvider,
  fileDescription,
  isInvoice,
  sameProduct,
  useUpload,
  type ExtractedLine,
  type ProposedChange,
  type UploadPhase,
};
