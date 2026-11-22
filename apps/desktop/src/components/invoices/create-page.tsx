import type { ProductId } from "@store/contracts";
import * as React from "react";

import { InvoiceCheckout, InvoiceCheckoutBar } from "@/components/invoices/create-checkout";
import { InvoiceCreateProvider, useInvoiceCreate } from "@/components/invoices/create-context";
import { InvoiceItems } from "@/components/invoices/create-items";
import { SaleDiscardDialog, SaleDraftTabs } from "@/components/invoices/draft-tabs";
import { ProductResolver } from "@/components/invoices/resolve-product";
import { PageLayout } from "@/components/shared/page-layout";
import { toastManager } from "@/components/ui/toast";
import { saleDraftShortcut, type ShortcutFocus } from "@/lib/sale-draft-shortcut";
import {
  hasOpenModal,
  isEditableTarget,
  isInListbox,
  isSubmitChord,
  useWindowKeydown,
} from "@/lib/shortcuts";

const isBehindPopup = (event: KeyboardEvent) => hasOpenModal() || isInListbox(event.target);

const shortcutFocus = (target: EventTarget | null): ShortcutFocus => {
  if (!isEditableTarget(target)) return "page";
  const empty =
    (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
    target.value === "";
  return empty ? "emptyField" : "field";
};

function CompleteSaleShortcut() {
  const {
    actions: { completeSale },
  } = useInvoiceCreate();

  useWindowKeydown((event) => {
    if (!isSubmitChord(event) || isBehindPopup(event)) return;
    event.preventDefault();
    event.stopPropagation();
    completeSale();
  }, true);

  return null;
}

function SaleDraftShortcuts() {
  const {
    state: { draftId },
    actions: { activateDraftAt, cycleDraft, discardDraft },
    meta: { tabs },
  } = useInvoiceCreate();

  const focusedDraft = (event: KeyboardEvent) => {
    if (!(event.target instanceof Element)) return undefined;
    const focused = event.target.closest<HTMLElement>("[data-sale-draft]")?.dataset.saleDraft;
    return tabs.find((tab) => tab.id === focused)?.id;
  };

  useWindowKeydown((event) => {
    const shortcut = saleDraftShortcut(event, shortcutFocus(event.target));
    if (shortcut === null || isBehindPopup(event)) return;
    event.preventDefault();
    event.stopPropagation();
    switch (shortcut._tag) {
      case "Jump":
        return activateDraftAt(shortcut.index);
      case "Cycle":
        return cycleDraft(shortcut.step);
      case "Discard":
        return discardDraft(focusedDraft(event) ?? draftId);
    }
  }, true);

  return null;
}

function AddProductFromSearch({
  productId,
  onDone,
}: {
  readonly productId: ProductId;
  readonly onDone: () => void;
}) {
  const {
    actions: { addProduct },
  } = useInvoiceCreate();

  return (
    <ProductResolver
      onResolve={(product) => {
        if (product) addProduct(product);
        else toastManager.add({ title: "That product is no longer available.", type: "error" });
        onDone();
      }}
      productId={productId}
    />
  );
}

function InvoiceCreatePage({
  addProductId,
  onProductAdded,
}: {
  readonly addProductId?: ProductId;
  readonly onProductAdded: () => void;
}) {
  const summaryEnd = React.useRef<HTMLDivElement>(null);
  return (
    <InvoiceCreateProvider>
      <CompleteSaleShortcut />
      <SaleDraftShortcuts />
      {addProductId && (
        <AddProductFromSearch key={addProductId} onDone={onProductAdded} productId={addProductId} />
      )}
      <SaleDiscardDialog />
      <PageLayout>
        <SaleDraftTabs />
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <InvoiceItems />
          <div className="xl:sticky xl:top-4">
            <InvoiceCheckout />
            <div ref={summaryEnd} />
          </div>
        </div>
        <InvoiceCheckoutBar summaryEnd={summaryEnd} />
      </PageLayout>
    </InvoiceCreateProvider>
  );
}

export { InvoiceCreatePage };
