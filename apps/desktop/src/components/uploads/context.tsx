import type { Category, InvoiceExtractionLine, ProductId } from "@store/contracts";
import { invoiceUploadRejection } from "@store/contracts";
import type { InvoiceExtraction } from "@store/contracts/server-api.schema";
import * as Result from "effect/Result";
import { createContext, use, useRef, useState, type ReactNode } from "react";

import { toastManager } from "@/components/ui/toast";
import {
  DEFAULT_IMPORT_CATEGORY_NAME,
  importCategoryOf,
  type ImportCategory,
} from "@/components/uploads/import-category";
import {
  ambiguousImportProductMessage,
  importProductMatch,
} from "@/components/uploads/same-product";
import { parseExpiryDate } from "@/lib/format";
import { useCatalogProductLookup, useInventoryActions } from "@/lib/inventory";
import { useInvoiceReading } from "@/lib/invoice-reading";

type ExtractedLine = InvoiceExtractionLine;
type ProposedChange = ExtractedLine & {
  type: "create_product" | "add_inventory";
  productId?: ProductId;
};
type UploadPhase = "idle" | "processing" | "ready" | "syncing";
type InvoiceReference = {
  readonly supplier: string | null;
  readonly invoiceNumber: string | null;
};

interface UploadState {
  files: File[];
  phase: UploadPhase;
  changes: ProposedChange[];
  invoice: InvoiceReference | null;
  categories: readonly Category[];
  category: ImportCategory;
}

interface UploadActions {
  addFiles: (incoming: FileList | File[]) => void;
  removeFile: (file: File) => void;
  analyse: () => Promise<void>;
  applyChanges: () => Promise<void>;
  dropChanges: (received: ReadonlyArray<ProposedChange>) => void;
  chooseCategory: (id: string) => void;
  nameCategory: (name: string) => void;
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

const proposedChanges = (
  lines: InvoiceExtraction["lines"],
  products: Parameters<typeof importProductMatch>[1],
): Result.Result<Array<ProposedChange>, string> =>
  Result.all(
    lines.map((line): Result.Result<ProposedChange, string> => {
      const match = importProductMatch(line, products);
      switch (match._tag) {
        case "many":
          return Result.fail(ambiguousImportProductMessage(line.name, line.unitsPerPack));
        case "one":
          return Result.succeed({ ...line, type: "add_inventory", productId: match.id });
        case "none":
          return Result.succeed({ ...line, type: "create_product" });
      }
    }),
  );

function UploadProvider({
  children,
  categories,
}: {
  children: ReactNode;
  categories: readonly Category[];
}) {
  const inventory = useInventoryActions();
  const lookupProducts = useCatalogProductLookup();
  const { analyseInvoices, isOnline } = useInvoiceReading();
  const busyRef = useRef(false);
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [changes, setChanges] = useState<ProposedChange[]>([]);
  const [invoice, setInvoice] = useState<InvoiceReference | null>(null);
  const [chosenCategoryId, setChosenCategoryId] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState(DEFAULT_IMPORT_CATEGORY_NAME);
  const category = importCategoryOf(categories, chosenCategoryId, categoryName);

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
    const failed = (title: string) => {
      toastManager.add({ title, type: "error" });
      setPhase("idle");
    };
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
        failed("No received stock was found in the attachments.");
        return;
      }
      const proposed = proposedChanges(
        stockLines,
        await lookupProducts(stockLines.map((line) => line.name)),
      );
      if (Result.isFailure(proposed)) {
        failed(proposed.failure);
        return;
      }
      setChanges(proposed.success);
      setInvoice({ supplier: payload.supplier, invoiceNumber: payload.invoiceNumber });
      setPhase("ready");
      toastManager.add({
        title: "Analysis done. Review the proposed changes.",
        type: "success",
      });
    } catch (error) {
      failed(error instanceof Error ? error.message : "Could not analyse invoices.");
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
    if (category._tag === "New" && category.name.trim() === "") {
      toastManager.add({ title: "Name the category for the new products.", type: "error" });
      return;
    }
    busyRef.current = true;
    setPhase("syncing");
    try {
      const lines = changes.map((change) => ({
        name: change.name,
        batchNumber: change.batchNumber,
        expiresAt: parseExpiryDate(change.expiresAt),
        unitsPerPack: change.unitsPerPack,
        packQuantity: change.packQuantity,
        unitQuantity: change.unitQuantity,
        purchasePrice: change.packPrice,
        productId: change.productId ?? null,
      }));
      const result = await inventory.importInventory(
        category._tag === "Existing"
          ? { categoryId: category.id, lines }
          : { newCategory: { name: category.name }, lines },
      );
      setChanges([]);
      setFiles([]);
      setInvoice(null);
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

  const dropChanges = (received: ReadonlyArray<ProposedChange>) => {
    const remaining = changes.filter((change) => !received.includes(change));
    setChanges(remaining);
    if (remaining.length > 0) return;
    setFiles([]);
    setInvoice(null);
    setPhase("idle");
  };

  const processing = phase === "processing" || phase === "syncing";

  return (
    <UploadContext
      value={{
        state: { files, phase, changes, invoice, categories, category },
        actions: {
          addFiles,
          removeFile,
          analyse,
          applyChanges,
          dropChanges,
          chooseCategory: setChosenCategoryId,
          nameCategory: setCategoryName,
        },
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
  useUpload,
  type ExtractedLine,
  type InvoiceReference,
  type ProposedChange,
  type UploadPhase,
};
