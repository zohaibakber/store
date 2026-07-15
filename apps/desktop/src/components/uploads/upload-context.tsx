import { createContext, use, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Category, Product } from "@store/contracts";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { useOnline } from "@/hooks/use-online";

type ExtractedLine = {
  name: string;
  batchNumber: string | null;
  expiresAt: string | null;
  packQuantity: number;
  unitQuantity: number;
  unitsPerPack: number;
  packPrice: number | null;
};
type Extraction = {
  supplier: string | null;
  invoiceNumber: string | null;
  lines: ExtractedLine[];
};
type ProposedChange = ExtractedLine & {
  type: "create_product" | "add_inventory";
  productId?: string;
};
type GatewayModel = { id: string; name?: string; type?: string };
type ModelGroup = { provider: string; label: string; items: GatewayModel[] };
type UploadPhase = "idle" | "processing" | "ready" | "syncing";

interface UploadState {
  files: File[];
  phase: UploadPhase;
  changes: ProposedChange[];
  model: GatewayModel;
}

interface UploadActions {
  addFiles: (incoming: FileList | File[]) => void;
  removeFile: (file: File) => void;
  setModel: (model: GatewayModel) => void;
  analyse: () => Promise<void>;
  applyChanges: () => Promise<void>;
}

interface UploadMeta {
  groupedModels: ModelGroup[];
  processing: boolean;
  isOnline: boolean;
}

interface UploadContextValue {
  state: UploadState;
  actions: UploadActions;
  meta: UploadMeta;
}

const UploadContext = createContext<UploadContextValue | null>(null);

const defaultModel = "openai/gpt-4.1-mini";
const fallbackModels: GatewayModel[] = [
  { id: defaultModel, name: "GPT-4.1 mini" },
  { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
];
const providerLabels: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  vertex: "Google Vertex",
  mistral: "Mistral",
  meta: "Meta",
  cohere: "Cohere",
  groq: "Groq",
  deepseek: "DeepSeek",
  xai: "xAI",
  perplexity: "Perplexity",
  amazon: "Amazon Bedrock",
  bedrock: "Amazon Bedrock",
};

const providerLabel = (provider: string) =>
  providerLabels[provider] ??
  provider.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const groupModelsByProvider = (models: GatewayModel[]): ModelGroup[] => {
  const groups = new Map<string, GatewayModel[]>();
  for (const candidate of models) {
    const provider = candidate.id.split("/")[0] ?? candidate.id;
    const items = groups.get(provider);
    if (items) items.push(candidate);
    else groups.set(provider, [candidate]);
  }
  return Array.from(groups.entries()).map(([provider, items]) => ({
    provider,
    label: providerLabel(provider),
    items,
  }));
};

const fileDescription = (file: File) => {
  const kind = file.type === "application/pdf" ? "PDF" : "CSV";
  return `${kind} · ${Math.max(1, Math.ceil(file.size / 1024))} KB`;
};

const isInvoice = (file: File) => /\.(csv|pdf)$/i.test(file.name);

const sameProduct = (line: ExtractedLine, product: Product) =>
  product.name.trim().toLocaleLowerCase() === line.name.trim().toLocaleLowerCase();

const validTimestamp = (date: string | null) => {
  const timestamp = date ? Date.parse(date) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
};

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
  const [modelId, setModelId] = useState(defaultModel);
  const [models, setModels] = useState<GatewayModel[]>(fallbackModels);
  const groupedModels = useMemo(() => groupModelsByProvider(models), [models]);
  const model = models.find((candidate) => candidate.id === modelId) ?? {
    id: modelId,
  };

  useEffect(() => {
    let cancelled = false;
    const loadModels = async () => {
      if (!window.serverApi) throw new Error("The authenticated server bridge is unavailable.");
      const payload = (await window.serverApi.getModels()) as { data?: GatewayModel[] };
      const available = (payload.data ?? []).filter(
        (candidate) => candidate.type === "language" && candidate.id.includes("/"),
      );
      if (available.length === 0) throw new Error("No language models were returned.");
      return available;
    };
    void loadModels()
      .then((available) => {
        if (!cancelled) setModels(available);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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

  const setModel = (nextModel: GatewayModel) => {
    setModelId(nextModel.id);
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
      const payload = (await window.serverApi.analyseInvoices({
        model: modelId,
        files: await Promise.all(
          files.map(async (file) => ({
            name: file.name,
            type: file.type,
            bytes: await file.arrayBuffer(),
          })),
        ),
      })) as Extraction;
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
      const createdProducts = new Map<string, string>();
      for (const change of changes) {
        const productKey = change.name.trim().toLocaleLowerCase();
        const productId =
          change.productId ??
          createdProducts.get(productKey) ??
          (
            await window.offlineStore.createProduct({
              name: change.name,
              categoryId: generalCategory.id,
              aisle: null,
              composition: null,
              strength: null,
              unitsPerPack: change.unitsPerPack,
              packPrice: change.packPrice,
              unitPrice: null,
            })
          ).id;
        if (!change.productId) createdProducts.set(productKey, productId);
        if (change.packQuantity + change.unitQuantity > 0)
          await window.offlineStore.createBatch({
            productId,
            batchNumber: change.batchNumber,
            expiresAt: validTimestamp(change.expiresAt),
            packQuantity: change.packQuantity,
            unitQuantity: change.unitQuantity,
          });
      }
      const syncStatus = await window.offlineStore.sync();
      if (syncStatus.phase === "error") throw new Error(syncStatus.message);
      toast.success(`${changes.length} inventory changes applied locally.`);
      await router.invalidate();
      setChanges([]);
      setFiles([]);
      setPhase("idle");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not apply changes.");
      setPhase("ready");
    }
  };

  const processing = phase === "processing" || phase === "syncing";

  return (
    <UploadContext
      value={{
        state: { files, phase, changes, model },
        actions: { addFiles, removeFile, setModel, analyse, applyChanges },
        meta: { groupedModels, processing, isOnline },
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
  groupModelsByProvider,
  isInvoice,
  providerLabel,
  sameProduct,
  useUpload,
  validTimestamp,
  type ExtractedLine,
  type Extraction,
  type GatewayModel,
  type ModelGroup,
  type ProposedChange,
  type UploadPhase,
};
