import { useEffect, useEffectEvent } from "react";

import { InvoiceCheckout } from "@/components/invoices/create-checkout";
import { InvoiceCreateProvider, useInvoiceCreate } from "@/components/invoices/create-context";
import { InvoiceItems } from "@/components/invoices/create-items";
import { SaleDraftTabs } from "@/components/invoices/draft-tabs";
import { ProductResolver } from "@/components/invoices/resolve-product";
import { PageLayout } from "@/components/shared/page-layout";
import { toastManager } from "@/components/ui/toast";
import { saleDraftShortcut } from "@/lib/sale-draft-shortcut";

const isInDialog = (event: KeyboardEvent) =>
  event.target instanceof Element && event.target.closest("[role=dialog]") !== null;

function CompleteSaleShortcut() {
  const {
    actions: { completeSale },
  } = useInvoiceCreate();

  const complete = useEffectEvent(() => void completeSale());

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (isInDialog(event)) return;
      event.preventDefault();
      event.stopPropagation();
      complete();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return null;
}

function SaleDraftShortcuts() {
  const {
    state: { draftId },
    actions: { activateDraftAt, cycleDraft, discardDraft },
  } = useInvoiceCreate();

  const run = useEffectEvent((event: KeyboardEvent) => {
    const shortcut = saleDraftShortcut(event);
    if (shortcut === null || isInDialog(event)) return;
    event.preventDefault();
    event.stopPropagation();
    switch (shortcut._tag) {
      case "Jump":
        return activateDraftAt(shortcut.index);
      case "Cycle":
        return cycleDraft(shortcut.step);
      case "Discard":
        return discardDraft(draftId);
    }
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => run(event);
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return null;
}

function AddProductFromSearch({
  productId,
  onDone,
}: {
  readonly productId: string;
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
  readonly addProductId?: string;
  readonly onProductAdded: () => void;
}) {
  return (
    <InvoiceCreateProvider>
      <CompleteSaleShortcut />
      <SaleDraftShortcuts />
      {addProductId && (
        <AddProductFromSearch key={addProductId} onDone={onProductAdded} productId={addProductId} />
      )}
      <SaleDraftTabs />
      <PageLayout>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <InvoiceItems />
          <div className="lg:sticky lg:top-12">
            <InvoiceCheckout />
          </div>
        </div>
      </PageLayout>
    </InvoiceCreateProvider>
  );
}

export { InvoiceCreatePage };
