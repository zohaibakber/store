import { createFileRoute } from "@tanstack/react-router";

import { InvoicesPage } from "@/components/invoices/page";
import { useInventoryInvoices, useInventoryState } from "@/lib/inventory-db";

export const Route = createFileRoute("/invoices/")({
  component: InvoicesRoute,
});

function InvoicesRoute() {
  const state = useInventoryState();
  if (!state || state._tag !== "Ready") throw new Error("Invoice storage is not ready.");
  return <LiveInvoices inventory={state.inventory} />;
}

function LiveInvoices({
  inventory,
}: {
  readonly inventory: Extract<
    NonNullable<ReturnType<typeof useInventoryState>>,
    { _tag: "Ready" }
  >["inventory"];
}) {
  const invoices = useInventoryInvoices(inventory);
  if (invoices.isError && invoices.data.length === 0) {
    return <p className="p-6 text-sm text-destructive">Could not load invoices.</p>;
  }
  return <InvoicesPage invoices={invoices.data} />;
}
