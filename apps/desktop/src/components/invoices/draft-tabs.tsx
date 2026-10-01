import { Cancel01Icon, PauseIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatPrice } from "@store/services/format";
import { useEffect, useRef } from "react";

import { useInvoiceCreate, type SaleDraftTab } from "@/components/invoices/create-context";
import { PageActions } from "@/components/shared/page-actions";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { saleDraftLimitMessage } from "@/hooks/use-sale-drafts";
import { appHost } from "@/host";
import { MAX_SALE_DRAFTS } from "@/lib/sale-drafts";

function DraftButton({
  active,
  index,
  tab,
}: {
  readonly active: boolean;
  readonly index: number;
  readonly tab: SaleDraftTab;
}) {
  const {
    actions: { activateDraft, discardDraft },
  } = useInvoiceCreate();
  const shortcut = index < MAX_SALE_DRAFTS ? `Alt+${index + 1} ` : "";

  return (
    <span className="group relative inline-flex shrink-0" data-active={active ? "" : undefined}>
      <Button
        aria-keyshortcuts={`${shortcut}Delete`}
        aria-pressed={active}
        onClick={() => activateDraft(tab.id)}
        onKeyDown={(event) => {
          if (event.key !== "Delete") return;
          event.preventDefault();
          discardDraft(tab.id);
        }}
        size="sm"
        variant={active ? "secondary" : "ghost"}
      >
        <span className="max-w-32 truncate">{tab.label}</span>
        {tab.lineCount > 0 && (
          <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">
            {formatPrice(tab.total)}
          </span>
        )}
        <span aria-hidden="true" className="w-4 shrink-0" />
      </Button>
      <span className="absolute end-1 top-1/2 inline-flex -translate-y-1/2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <Button
          aria-label={`Discard ${tab.label}`}
          onClick={() => discardDraft(tab.id)}
          size="icon-xs"
          tabIndex={-1}
          variant="ghost"
        >
          <HugeiconsIcon aria-hidden="true" icon={Cancel01Icon} />
        </Button>
      </span>
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
  const several = tabs.length > 1;
  const started = lines.length > 0 || customerName.trim() !== "";

  useEffect(() => {
    stripRef.current
      ?.querySelector("[data-active]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [draftId]);

  if (!several) {
    return started ? (
      <PageActions>
        <HoldSaleButton started />
      </PageActions>
    ) : null;
  }

  return (
    <PageActions>
      <div
        aria-label="Open sales"
        className="flex min-w-0 scrollbar-none items-center gap-1 overflow-x-auto"
        ref={stripRef}
        role="group"
      >
        {tabs.map((tab, index) => (
          <DraftButton active={tab.id === draftId} index={index} key={tab.id} tab={tab} />
        ))}
      </div>
      <HoldSaleButton started={started} />
    </PageActions>
  );
}

export { SaleDraftTabs };
