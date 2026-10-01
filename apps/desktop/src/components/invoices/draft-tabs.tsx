import { Cancel01Icon, PauseIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef } from "react";

import { useInvoiceCreate, type SaleDraftTab } from "@/components/invoices/create-context";
import { PageActions } from "@/components/shared/page-actions";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { saleDraftLimitMessage } from "@/hooks/use-sale-drafts";
import { appHost } from "@/host";
import { MAX_SALE_DRAFTS } from "@/lib/sale-drafts";
import { cn } from "@/lib/utils";

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
    <span className="relative inline-flex shrink-0" data-active={active ? "" : undefined}>
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
        variant={active ? "default" : "secondary"}
      >
        <span className="max-w-32 truncate">{tab.label}</span>
        <span aria-hidden="true" className="w-3.5 shrink-0" />
      </Button>
      <button
        aria-label={`Discard ${tab.label}`}
        className={cn(
          "absolute end-1.25 top-1/2 inline-flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md opacity-64 outline-none hover:opacity-100 focus-visible:opacity-100",
          active ? "text-primary-foreground" : "text-secondary-foreground",
        )}
        onClick={() => discardDraft(tab.id)}
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
        className="flex min-w-0 scrollbar-none items-center gap-1.5 overflow-x-auto"
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
