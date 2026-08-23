import { createFileRoute } from "@tanstack/react-router";

import { InvoiceCreatePage } from "@/components/invoices/create-page";
import { useCatalogProducts, useInventoryState } from "@/lib/inventory-db";

export const Route = createFileRoute("/invoices/new")({
  component: NewInvoiceRoute,
  staticData: { breadcrumb: "New invoice" },
});

function NewInvoiceRoute() {
  const state = useInventoryState();
  if (!state || state._tag !== "Ready") throw new Error("Invoice storage is not ready.");
  return <LiveInvoiceCreate inventory={state.inventory} />;
}

function LiveInvoiceCreate({
  inventory,
}: {
  readonly inventory: Extract<
    NonNullable<ReturnType<typeof useInventoryState>>,
    { _tag: "Ready" }
  >["inventory"];
}) {
  const products = useCatalogProducts(inventory);
  if (products.data.length > 0) return <InvoiceCreatePage products={products.data} />;
  if (products.isError) {
    return <p className="p-6 text-sm text-destructive">Could not load products.</p>;
  }
  if (!products.isReady && products.data.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">Loading products…</p>;
  }
  return <InvoiceCreatePage products={products.data} />;
}
