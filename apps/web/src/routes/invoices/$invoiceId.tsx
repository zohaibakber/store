import { createFileRoute } from "@tanstack/react-router";

import { InvoiceDetailError, InvoiceDetailPage } from "@/components/invoices/detail-page";
import { useInventoryInvoice, useInventoryState } from "@/lib/inventory-db";

export const Route = createFileRoute("/invoices/$invoiceId")({
  component: InvoiceDetailRoute,
  errorComponent: InvoiceDetailError,
  staticData: { breadcrumb: "Invoice" },
});

function InvoiceDetailRoute() {
  const { invoiceId } = Route.useParams();
  const state = useInventoryState();
  if (!state || state._tag !== "Ready") throw new Error("Invoice storage is not ready.");
  return <LiveInvoiceDetail inventory={state.inventory} invoiceId={invoiceId} />;
}

function LiveInvoiceDetail({
  inventory,
  invoiceId,
}: {
  readonly inventory: Extract<
    NonNullable<ReturnType<typeof useInventoryState>>,
    { _tag: "Ready" }
  >["inventory"];
  readonly invoiceId: string;
}) {
  const invoice = useInventoryInvoice(inventory, invoiceId);
  if (invoice.data) return <InvoiceDetailPage invoice={invoice.data} />;
  if (invoice.isError) {
    return <InvoiceDetailError error={new Error("The invoice could not be loaded.")} />;
  }
  if (!invoice.isReady && !invoice.data) {
    return <p className="p-6 text-sm text-muted-foreground">Loading invoice…</p>;
  }
  return <InvoiceDetailError error={new Error(`Invoice ${invoiceId} was not found.`)} />;
}
