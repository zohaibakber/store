import { Add01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { formatPrice } from "@store/services/format";
import { useEffect, useRef } from "react";

import { useInvoiceCreate, type SaleDraftTab } from "@/components/invoices/create-context";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { saleDraftLimitMessage } from "@/hooks/use-sale-drafts";
import { appHost } from "@/host";
import { formatNumber } from "@/lib/format";
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
        className="max-w-64 grow-0"
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
            · {formatNumber(tab.lineCount)} · {formatPrice(tab.total)}
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

function SaleDraftTabs() {
  const {
    state: { draftId },
    actions: { openDraft },
    meta: { canOpenDraft, tabs },
  } = useInvoiceCreate();
  const shortcut = appHost().newSaleShortcut;
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    stripRef.current
      ?.querySelector("[data-active]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [draftId]);

  return (
    <div className="flex min-w-0 items-center gap-1 border-b">
      <div className="min-w-0 scrollbar-none overflow-x-auto pb-px" ref={stripRef}>
        <Tabs value={draftId}>
          <TabsList aria-label="Open sales" variant="underline">
            {tabs.map((tab, index) => (
              <DraftTab index={index} key={tab.id} tab={tab} />
            ))}
          </TabsList>
        </Tabs>
      </div>
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
    </div>
  );
}

export { SaleDraftTabs };
