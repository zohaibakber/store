import type { Category, InvoiceExtractionLine, Product, ProductId } from "@store/contracts";
import { invoiceUploadRejection } from "@store/contracts";
import { createContext, use, useRef, useState, type ReactNode } from "react";

import { toastManager } from "@/components/ui/toast";
import {
  ambiguousImportProductMessage,
  importProductMatch,
} from "@/components/uploads/same-product";
import { useOnline } from "@/hooks/use-online";
import { parseExpiryDate } from "@/lib/format";
import { useInventoryActions } from "@/lib/inventory-db";
import { analyseInvoices } from "@/lib/server-api";

type ExtractedLine = InvoiceExtractionLine;
type ProposedChange = ExtractedLine & {
  type: "create_product" | "add_inventory";
  productId?: ProductId;
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

function UploadProvider({
  children,
  products,
  categories,
}: {
  children: ReactNode;
  products: readonly Product[];
  categories: readonly Category[];
}) {
  const inventory = useInventoryActions();
  const isOnline = useOnline();
  const busyRef = useRef(false);
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [changes, setChanges] = useState<ProposedChange[]>([]);

  const addFiles = (incoming: FileList | File[]) => {
    const valid = Array.from(incoming).filter(isInvoice);
    if (valid.length !== Array.from(incoming).length)
      toastManager.add({
        title: "Only PDF and CSV invoice files can be uploaded.",
        type: "error",
      });
    setFiles((current) => {
      const next = [...current, ...valid].filter(
        (file, index, list) =>
          list.findIndex(
            (candidate) => candidate.name === file.name && candidate.size === file.size,
          ) === index,
      );
      const rejection = invoiceUploadRejection(next.map((file) => ({ byteLength: file.size })));
      if (!rejection) return next;
      toastManager.add({ title: rejection, type: "error" });
      return current;
    });
  };

  const removeFile = (file: File) => {
    setFiles((current) => current.filter((candidate) => candidate !== file));
  };

  const analyse = async () => {
    if (busyRef.current) return;
    if (!isOnline) {
      toastManager.add({
        title: "You're offline. Connect before analysing invoices.",
        type: "error",
      });
      return;
    }
    if (!files.length) {
      toastManager.add({ title: "Add at least one invoice first.", type: "error" });
      return;
    }
    busyRef.current = true;
    setPhase("processing");
    try {
      const payload = await analyseInvoices(
        await Promise.all(
          files.map(async (file) => ({
            name: file.name,
            type: file.type,
            bytes: await file.arrayBuffer(),
          })),
        ),
      );
      const stockLines = payload.lines.filter((line) => line.packQuantity + line.unitQuantity > 0);
      if (stockLines.length === 0) {
        throw new Error("No received stock was found in the attachments.");
      }
      setChanges(
        stockLines.map((line) => {
          const match = importProductMatch(line, products);
          if (match._tag === "many") {
            throw new Error(ambiguousImportProductMessage(line.name, line.unitsPerPack));
          }
          return match._tag === "one"
            ? { ...line, type: "add_inventory", productId: match.id }
            : { ...line, type: "create_product" };
        }),
      );
      setPhase("ready");
      toastManager.add({
        title: "Analysis done. Review the proposed changes.",
        type: "success",
      });
    } catch (error) {
      toastManager.add({
        title: error instanceof Error ? error.message : "Could not analyse invoices.",
        type: "error",
      });
      setPhase("idle");
    } finally {
      busyRef.current = false;
    }
  };

  const applyChanges = async () => {
    if (busyRef.current) return;
    if (!isOnline) {
      toastManager.add({
        title: "You're offline. Reconnect, then apply the changes.",
        type: "error",
      });
      return;
    }
    const generalCategory =
      categories.find((category) => category.name.trim().toLocaleLowerCase() === "general") ??
      categories[0];
    if (!generalCategory) {
      toastManager.add({
        title: "Create a category before importing inventory.",
        type: "error",
      });
      return;
    }
    busyRef.current = true;
    setPhase("syncing");
    try {
      const result = await inventory.importInventory({
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
      setChanges([]);
      setFiles([]);
      toastManager.add({
        title: `Created ${result.createdProducts} products and ${result.createdBatches} batches.`,
        type: "success",
      });
      setPhase("idle");
    } catch (error) {
      toastManager.add({
        title: error instanceof Error ? error.message : "Could not apply changes.",
        type: "error",
      });
      setPhase("ready");
    } finally {
      busyRef.current = false;
    }
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
  useUpload,
  type ExtractedLine,
  type ProposedChange,
  type UploadPhase,
};
