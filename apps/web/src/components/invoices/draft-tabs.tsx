import { Cancel01Icon, PauseIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { InvoiceId } from "@store/contracts/ids";
import { formatPrice } from "@store/services/format";
import { useEffect, useId, useRef } from "react";

import { useInvoiceCreate } from "@/components/invoices/create-context";
import { PageActions } from "@/components/shared/page-actions";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { saleDraftLimitMessage } from "@/hooks/use-sale-drafts";
import { appHost } from "@/host";
import { formatCount } from "@/lib/format";
import { MAX_SALE_DRAFTS } from "@/lib/sale-drafts";
import { cn } from "@/lib/utils";

function DraftButton({
  active,
  hintId,
  id,
  index,
  label,
}: {
  readonly active: boolean;
  readonly hintId: string;
  readonly id: InvoiceId;
  readonly index: number;
  readonly label: string;
}) {
  const {
    actions: { activateDraft, discardDraft },
  } = useInvoiceCreate();

  return (
    <span
      className="relative inline-flex shrink-0"
      data-active={active ? "" : undefined}
      data-sale-draft={id}
    >
      <Button
        aria-describedby={hintId}
        aria-keyshortcuts={index < MAX_SALE_DRAFTS ? `Alt+${index + 1}` : undefined}
        aria-pressed={active}
        onClick={() => activateDraft(id)}
        onKeyDown={(event) => {
          if (event.key !== "Delete") return;
          event.preventDefault();
          discardDraft(id);
        }}
        size="sm"
        variant={active ? "default" : "secondary"}
      >
        <span className="max-w-32 truncate">{label}</span>
        <span aria-hidden="true" className="w-3.5 shrink-0" />
      </Button>
      <button
        aria-label={`Discard ${label}`}
        className={cn(
          "absolute end-1.25 top-1/2 inline-flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md opacity-64 outline-none hover:opacity-100 focus-visible:opacity-100",
          active ? "text-primary-foreground" : "text-secondary-foreground",
        )}
        onClick={() => discardDraft(id)}
        tabIndex={-1}
        type="button"
      >
        <HugeiconsIcon aria-hidden="true" className="size-3.5" icon={Cancel01Icon} />
      </button>
    </span>
  );
}

function HoldSaleButton({ started }: { readonly started: boolean }) {
  const {
    actions: { openDraft },
    meta: { canOpenDraft },
  } = useInvoiceCreate();
  const shortcut = appHost().newSaleShortcut;
  const enabled = started && canOpenDraft;

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
        <Button
          aria-keyshortcuts={shortcut.ariaKeyShortcuts}
          disabled={!enabled}
          onClick={openDraft}
          size="sm"
          variant="outline"
        >
          <HugeiconsIcon aria-hidden="true" icon={PauseIcon} />
          Hold sale
        </Button>
      </TooltipTrigger>
      <TooltipPopup>
        {enabled ? (
          <span className="inline-flex items-center gap-2">
            Keep this sale open and start another
            <Kbd>{shortcut.label}</Kbd>
          </span>
        ) : started ? (
          saleDraftLimitMessage
        ) : (
          "Add a product to this sale before holding it."
        )}
      </TooltipPopup>
    </Tooltip>
  );
}

function SaleDraftTabs() {
  const {
    state: { customerName, draftId, lines },
    meta: { tabs },
  } = useInvoiceCreate();
  const stripRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const several = tabs.length > 1;
  const started = lines.length > 0 || customerName.trim() !== "";

  useEffect(() => {
    stripRef.current
      ?.querySelector("[data-active]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [draftId]);

  if (!several && !started) return null;

  return (
    <PageActions>
      <div
        aria-label="Open sales"
        className="flex min-w-0 scrollbar-none items-center gap-1.5 overflow-x-auto"
        ref={stripRef}
        role="group"
      >
        {tabs.map((tab, index) => (
          <DraftButton
            active={tab.id === draftId}
            hintId={hintId}
            id={tab.id}
            index={index}
            key={tab.id}
            label={tab.label}
          />
        ))}
        <span className="sr-only" id={hintId}>
          Press Delete to discard this sale.
        </span>
      </div>
      <HoldSaleButton started={started} />
    </PageActions>
  );
}

function SaleDiscardDialog() {
  const {
    actions: { cancelDiscard, confirmDiscard },
    meta: { discarding },
  } = useInvoiceCreate();

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) cancelDiscard();
      }}
      open={discarding !== null}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard this sale?</AlertDialogTitle>
          <AlertDialogDescription>
            {discarding === null
              ? null
              : discarding.lineCount > 0
                ? `${discarding.label} has ${formatCount(discarding.lineCount, "line")} worth ${formatPrice(discarding.total)}. It will not be saved.`
                : `${discarding.label} has no items yet. It will not be saved.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
          <Button onClick={confirmDiscard} variant="destructive">
            Discard
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export { SaleDiscardDialog, SaleDraftTabs };
