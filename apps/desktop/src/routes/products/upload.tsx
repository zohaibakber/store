import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import type { Product } from "@store/contracts";
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  FileAttachmentIcon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import {
  PageAction,
  PageContent,
  PageDescription,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/page-layout";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "@/components/ui/combobox";

type ExtractedLine = {
  name: string;
  batchNumber: string | null;
  expiresAt: string | null;
  packQuantity: number;
  unitQuantity: number;
  unitsPerPack: number;
  packPrice: number | null;
};
type Extraction = { supplier: string | null; invoiceNumber: string | null; lines: ExtractedLine[] };
type ProposedChange = ExtractedLine & {
  type: "create_product" | "add_inventory";
  productId?: string;
};
type GatewayModel = { id: string; name?: string; type?: string };
type ModelGroup = { provider: string; label: string; items: GatewayModel[] };

export const Route = createFileRoute("/products/upload")({
  loader: async () => {
    const [products, categories] = await Promise.all([
      window.offlineStore.listProducts(),
      window.offlineStore.listCategories(),
    ]);
    return { products, categories };
  },
  component: UploadInvoicesPage,
});

const apiUrl = () => import.meta.env.VITE_API_URL ?? "http://localhost:8787/api";
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

function UploadInvoicesPage() {
  const { products, categories } = Route.useLoaderData();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [state, setState] = useState<"idle" | "processing" | "ready" | "syncing">("idle");
  const [changes, setChanges] = useState<ProposedChange[]>([]);
  const [model, setModel] = useState(defaultModel);
  const [models, setModels] = useState<GatewayModel[]>(fallbackModels);
  const groupedModels = useMemo(() => groupModelsByProvider(models), [models]);
  const selectedModel =
    models.find((candidate) => candidate.id === model) ?? ({ id: model } satisfies GatewayModel);

  useEffect(() => {
    let cancelled = false;
    const loadModels = async (url: string) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Could not load AI Gateway models.");
      const payload = (await response.json()) as { data?: GatewayModel[] };
      const available = (payload.data ?? []).filter(
        (candidate) => candidate.type === "language" && candidate.id.includes("/"),
      );
      if (available.length === 0) throw new Error("No language models were returned.");
      return available;
    };
    void loadModels(`${apiUrl()}/models`)
      .catch(() => loadModels("https://ai-gateway.vercel.sh/v1/models"))
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

  const analyse = async () => {
    if (!navigator.onLine) {
      toast.error("You’re offline. Connect to the internet before analysing invoices.");
      return;
    }
    if (!files.length) {
      toast.error("Add at least one invoice first.");
      return;
    }
    setState("processing");
    try {
      const body = new FormData();
      files.forEach((file) => body.append("files", file));
      body.append("model", model);
      const response = await fetch(`${apiUrl()}/uploads`, { method: "POST", body });
      const payload = (await response.json()) as Extraction & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Invoice analysis failed.");
      setChanges(
        payload.lines.map((line) => {
          const product = products.find((candidate) => sameProduct(line, candidate));
          return product
            ? { ...line, type: "add_inventory", productId: product.id }
            : { ...line, type: "create_product" };
        }),
      );
      setState("ready");
      toast.success("Invoice analysis complete. Review the proposed changes.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not analyse invoices.");
      setState("idle");
    }
  };

  const applyChanges = async () => {
    if (!navigator.onLine) {
      toast.error("You’re offline. Changes remain ready to apply when you reconnect.");
      return;
    }
    setState("syncing");
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
      setState("idle");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not apply changes.");
      setState("ready");
    }
  };

  const processing = state === "processing" || state === "syncing";
  return (
    <PageLayout>
      <PageHeader>
        <PageHeading>Upload invoices</PageHeading>
        <PageDescription>
          Upload supplier CSVs and PDFs. AI extracts stock, then you approve every local inventory
          change.
        </PageDescription>
        <PageAction>
          <Button disabled={processing || !files.length} onClick={() => void analyse()}>
            <HugeiconsIcon data-icon="inline-start" icon={Upload01Icon} />
            Analyse invoices
          </Button>
        </PageAction>
      </PageHeader>
      <PageContent>
        {!navigator.onLine && (
          <Alert variant="destructive">
            <HugeiconsIcon icon={Alert02Icon} />
            <AlertTitle>You’re offline</AlertTitle>
            <AlertDescription>
              Invoice uploads need a connection. Your selected files and review stay on this screen.
            </AlertDescription>
          </Alert>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Attachments</CardTitle>
            <CardDescription>
              Choose one or more supplier invoices in PDF or CSV format.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="invoice-model">Invoice model</FieldLabel>
              <Combobox
                items={groupedModels}
                value={selectedModel}
                isItemEqualToValue={(item: GatewayModel, value: GatewayModel) =>
                  item.id === value.id
                }
                itemToStringLabel={(item: GatewayModel) => item.name ?? item.id}
                onValueChange={(value: GatewayModel | null) => value && setModel(value.id)}
              >
                <ComboboxInput id="invoice-model" className="w-full" placeholder="Search models…" />
                <ComboboxContent>
                  <ComboboxEmpty>No matching models.</ComboboxEmpty>
                  <ComboboxList>
                    {(group: ModelGroup) => (
                      <ComboboxGroup key={group.provider} items={group.items}>
                        <ComboboxLabel>{group.label}</ComboboxLabel>
                        <ComboboxCollection>
                          {(item: GatewayModel) => (
                            <ComboboxItem key={item.id} value={item}>
                              {item.name ?? item.id}
                            </ComboboxItem>
                          )}
                        </ComboboxCollection>
                      </ComboboxGroup>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </Field>
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
                        onClick={() =>
                          setFiles((current) => current.filter((candidate) => candidate !== file))
                        }
                      >
                        <HugeiconsIcon icon={Delete02Icon} />
                      </AttachmentAction>
                    </AttachmentActions>
                  </Attachment>
                ))}
              </AttachmentGroup>
            )}
            {processing && (
              <Progress value={state === "syncing" ? 75 : 45}>
                <ProgressLabel>
                  {state === "syncing" ? "Applying changes" : "Reading invoices with AI"}
                </ProgressLabel>
                <ProgressValue>
                  {() => (state === "syncing" ? "Applying" : "Analysing")}
                </ProgressValue>
              </Progress>
            )}
          </CardContent>
        </Card>
        {changes.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>
                Proposed changes{" "}
                <Badge className="ml-2" variant="secondary">
                  {changes.length}
                </Badge>
              </CardTitle>
              <CardDescription>
                Nothing changes in your store until you apply this review.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ItemGroup>
                {changes.map((change, index) => (
                  <Item key={`${change.name}-${index}`} variant="outline">
                    <HugeiconsIcon
                      icon={
                        change.type === "create_product"
                          ? FileAttachmentIcon
                          : CheckmarkCircle02Icon
                      }
                    />
                    <ItemContent>
                      <ItemTitle>{change.name}</ItemTitle>
                      <ItemDescription>
                        {change.type === "create_product"
                          ? "New product will be created"
                          : "Existing product inventory will be updated"}
                        {` · ${change.packQuantity} packs · ${change.unitQuantity} units`}
                        {change.batchNumber ? ` · Batch ${change.batchNumber}` : ""}
                      </ItemDescription>
                    </ItemContent>
                    <Badge variant={change.type === "create_product" ? "default" : "secondary"}>
                      {change.type === "create_product" ? "New product" : "Inventory update"}
                    </Badge>
                  </Item>
                ))}
              </ItemGroup>
              <Button disabled={processing} onClick={() => void applyChanges()}>
                <HugeiconsIcon data-icon="inline-start" icon={CheckmarkCircle02Icon} />
                Apply {changes.length} changes
              </Button>
            </CardContent>
          </Card>
        )}
        {!files.length && !changes.length && (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={Upload01Icon} />
              </EmptyMedia>
              <EmptyTitle>No invoices selected</EmptyTitle>
              <EmptyDescription>
                Upload supplier files to turn received stock into a reviewable list of local
                changes.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </PageContent>
    </PageLayout>
  );
}
