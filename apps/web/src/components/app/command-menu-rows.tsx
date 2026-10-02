import { ArrowDown01Icon, ArrowUp01Icon, CornerDownLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Invoice, Product, StockStatus } from "@store/contracts";
import { productStock } from "@store/contracts/store-helpers";
import { useProductInsight, useSuspenseCatalogProduct } from "@store/inventory-react";
import { formatPrice } from "@store/services/format";
import { Suspense, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { CommandShortcut } from "@/components/ui/command";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import type { RecentProduct } from "@/hooks/use-recent-products";
import { EMPTY, formatCount } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";

import type { Entry, Page } from "./command-menu-entries";

export function Hint({ keys, label }: { readonly keys: ReactNode; readonly label: string }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      {keys}
      <span>{label}</span>
    </span>
  );
}

const enterKey = (
  <Kbd>
    <HugeiconsIcon aria-hidden="true" icon={CornerDownLeftIcon} />
  </Kbd>
);

export function FooterHints({
  entry,
  onOpenActions,
  page,
}: {
  readonly entry: Entry | undefined;
  readonly onOpenActions: () => void;
  readonly page: Page;
}) {
  if (!entry && page.kind === "root") return <span />;

  const navigate = (
    <Hint
      keys={
        <KbdGroup>
          <Kbd>
            <HugeiconsIcon aria-hidden="true" icon={ArrowUp01Icon} />
          </Kbd>
          <Kbd>
            <HugeiconsIcon aria-hidden="true" icon={ArrowDown01Icon} />
          </Kbd>
        </KbdGroup>
      }
      label="Navigate"
    />
  );

  if (page.kind === "product") {
    return (
      <div className="flex items-center gap-4">
        {navigate}
        <Hint keys={enterKey} label="Run" />
      </div>
    );
  }

  if (entry?.kind === "product" || entry?.kind === "recent") {
    return (
      <div className="flex items-center gap-4">
        <Hint keys={enterKey} label="Open" />
        <Hint
          keys={
            <KbdGroup>
              <Kbd>Ctrl</Kbd>
              {enterKey}
            </KbdGroup>
          }
          label="Add to sale"
        />
        <Button
          onClick={onOpenActions}
          onMouseDown={(event) => event.preventDefault()}
          size="xs"
          variant="ghost"
        >
          <Hint
            keys={
              <KbdGroup>
                <Kbd>Ctrl</Kbd>
                <Kbd>.</Kbd>
              </KbdGroup>
            }
            label="Actions"
          />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      {navigate}
      <Hint
        keys={enterKey}
        label={
          entry?.kind === "invoice" ? "Open invoice" : entry?.kind === "action" ? "Run" : "Open"
        }
      />
    </div>
  );
}

export function EntryRow({ entry }: { readonly entry: Entry }) {
  switch (entry.kind) {
    case "product":
      return <ProductRow product={entry.product} />;
    case "recent":
      return (
        <Suspense fallback={<RecentSnapshotRow recent={entry.recent} />}>
          <LiveRecentRow recent={entry.recent} />
        </Suspense>
      );
    case "invoice":
      return <InvoiceRow invoice={entry.invoice} />;
    case "action":
      return (
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          <HugeiconsIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
            icon={entry.icon}
          />
          <span className="min-w-0 flex-1 truncate">{entry.label}</span>
          {entry.shortcut ? <CommandShortcut>{entry.shortcut}</CommandShortcut> : null}
        </span>
      );
  }
}

function ProductName({
  name,
  strength,
  categoryName,
}: {
  readonly name: string;
  readonly strength: string | null;
  readonly categoryName: string;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      <span className="min-w-0 truncate">
        {name}
        {strength ? <span className="text-muted-foreground"> {strength}</span> : null}
      </span>
      <span className="max-w-40 shrink-0 truncate text-xs text-muted-foreground">
        {categoryName}
      </span>
    </span>
  );
}

function LiveRecentRow({ recent }: { readonly recent: RecentProduct }) {
  const product = useSuspenseCatalogProduct(recent.id);
  return product ? <ProductRow product={product} /> : <RecentSnapshotRow recent={recent} />;
}

function RecentSnapshotRow({ recent }: { readonly recent: RecentProduct }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-4">
      <ProductName
        categoryName={recent.categoryName}
        name={recent.name}
        strength={recent.strength}
      />
    </span>
  );
}

function ProductRow({ product }: { readonly product: Product }) {
  const stock = productStock(product);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-4">
      <ProductName
        categoryName={product.category.name}
        name={product.name}
        strength={product.strength}
      />
      <Suspense fallback={<StockLabel status={null} stock={stock} />}>
        <LiveStockLabel productId={product.id} stock={stock} />
      </Suspense>
      <span className="w-20 shrink-0 text-right tabular-nums">
        {product.unitPrice === null ? EMPTY : formatPrice(product.unitPrice)}
      </span>
    </span>
  );
}

function LiveStockLabel({
  productId,
  stock,
}: {
  readonly productId: string;
  readonly stock: number;
}) {
  const insight = useProductInsight(productId);
  return <StockLabel status={insight?.status ?? null} stock={stock} />;
}

type StockTone = { readonly label: string; readonly className: string };

const STATUS_TONE = {
  out: { label: "Out of stock", className: "text-destructive-foreground" },
  critical: { label: "Running out", className: "text-destructive-foreground" },
  low: { label: "Reorder", className: "text-warning-foreground" },
} satisfies Partial<Record<StockStatus, StockTone>>;

const stockTone = (status: StockStatus | null, stock: number): StockTone | undefined => {
  if (stock <= 0 || status === "out") return STATUS_TONE.out;
  if (status === "critical") return STATUS_TONE.critical;
  if (status === "low") return STATUS_TONE.low;
  return undefined;
};

function StockLabel({
  status,
  stock,
}: {
  readonly status: StockStatus | null;
  readonly stock: number;
}) {
  const tone = stockTone(status, stock);
  return (
    <span
      className={cn(
        "flex w-28 shrink-0 items-center justify-end gap-1.5 text-xs tabular-nums",
        tone ? tone.className : "text-muted-foreground",
      )}
      title={tone?.label}
    >
      {tone && stock > 0 ? (
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      ) : null}
      {stock <= 0 ? "Out of stock" : formatCount(stock, "unit")}
      {tone && stock > 0 ? <span className="sr-only">, {tone.label}</span> : null}
    </span>
  );
}

function InvoiceRow({ invoice }: { readonly invoice: Invoice }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-4">
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="shrink-0 tabular-nums">#{invoice.invoiceNumber}</span>
        <span className="min-w-0 truncate text-muted-foreground">
          {invoice.customerName || EMPTY}
        </span>
      </span>
      <span className="w-28 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {formatDate(invoice.createdAt)}
      </span>
      <span className="w-20 shrink-0 text-right tabular-nums">{formatPrice(invoice.total)}</span>
    </span>
  );
}
