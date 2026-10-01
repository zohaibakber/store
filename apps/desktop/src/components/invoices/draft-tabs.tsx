import { Add01Icon, Cancel01Icon, PauseIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatPrice } from "@store/services/format";
import { useEffect, useRef } from "react";

import { useInvoiceCreate, type SaleDraftTab } from "@/components/invoices/create-context";
import { PageActions } from "@/components/shared/page-actions";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { saleDraftLimitMessage } from "@/hooks/use-sale-drafts";
import { appHost } from "@/host";
import { MAX_SALE_DRAFTS } from "@/lib/sale-drafts";

function DraftTab({ index, tab }: { readonly index: number; readonly tab: SaleDraftTab }) {
  const {
    actions: { activateDraft, discardDraft },
  } = useInvoiceCreate();
  const shortcut = index < MAX_SALE_DRAFTS ? `Alt+${index + 1} ` : "";

  return (
    <>
      <TabsTab
        aria-keyshortcuts={`${shortcut}Delete`}
        className="max-w-48 grow-0"
        onClick={() => activateDraft(tab.id)}
        onKeyDown={(event) => {
          if (event.key !== "Delete") return;
          event.preventDefault();
          discardDraft(tab.id);
        }}
        value={tab.id}
      >
        <span className="truncate">{tab.label}</span>
        {tab.lineCount > 0 && (
          <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">
            {formatPrice(tab.total)}
          </span>
        )}
        <span aria-hidden="true" className="w-4 shrink-0" />
      </TabsTab>
      <Button
        aria-hidden="true"
        aria-label={`Discard ${tab.label}`}
        className="relative z-10 -ms-7"
        onClick={() => discardDraft(tab.id)}
        size="icon-xs"
        tabIndex={-1}
        variant="ghost"
      >
        <HugeiconsIcon aria-hidden="true" icon={Cancel01Icon} />
      </Button>
    </>
  );
}

function NewDraftButton() {
  const {
    actions: { openDraft },
    meta: { canOpenDraft },
  } = useInvoiceCreate();
  const shortcut = appHost().newSaleShortcut;

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
        <Button
          aria-keyshortcuts={shortcut.ariaKeyShortcuts}
          aria-label="New sale"
          disabled={!canOpenDraft}
          onClick={openDraft}
          size="icon-sm"
          variant="ghost"
        >
          <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
        </Button>
      </TooltipTrigger>
      <TooltipPopup>
        {canOpenDraft ? (
          <span className="inline-flex items-center gap-2">
            New sale
            <Kbd>{shortcut.label}</Kbd>
          </span>
        ) : (
          saleDraftLimitMessage
        )}
      </TooltipPopup>
    </Tooltip>
  );
}

function HoldSaleButton() {
  const {
    actions: { openDraft },
  } = useInvoiceCreate();
  const shortcut = appHost().newSaleShortcut;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-keyshortcuts={shortcut.ariaKeyShortcuts}
            onClick={openDraft}
            size="sm"
            variant="outline"
          />
        }
      >
        <HugeiconsIcon aria-hidden="true" icon={PauseIcon} />
        Hold sale
      </TooltipTrigger>
      <TooltipPopup>
        <span className="inline-flex items-center gap-2">
          Keep this sale open and start another
          <Kbd>{shortcut.label}</Kbd>
        </span>
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

  useEffect(() => {
    stripRef.current
      ?.querySelector("[data-active]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [draftId]);

  if (!several) {
    const started = lines.length > 0 || customerName.trim() !== "";
    return started ? (
      <PageActions>
        <HoldSaleButton />
      </PageActions>
    ) : null;
  }

  return (
    <PageActions>
      <div className="min-w-0 scrollbar-none overflow-x-auto" ref={stripRef}>
        <Tabs value={draftId}>
          <TabsList aria-label="Open sales">
            {tabs.map((tab, index) => (
              <DraftTab index={index} key={tab.id} tab={tab} />
            ))}
          </TabsList>
        </Tabs>
      </div>
      <NewDraftButton />
    </PageActions>
  );
}

export { SaleDraftTabs };
