import { createFileRoute } from "@tanstack/react-router";

import { InvoiceDetailError, InvoiceDetailPage } from "@/components/invoices/detail-page";
import { useSuspenseInventoryInvoice } from "@/lib/inventory";

export const Route = createFileRoute("/invoices/$invoiceId")({
  component: InvoiceDetailRoute,
  errorComponent: InvoiceDetailError,
  staticData: { breadcrumb: "Invoice" },
});

function InvoiceDetailRoute() {
  const { invoiceId } = Route.useParams();
  const invoice = useSuspenseInventoryInvoice(invoiceId);
  if (!invoice) throw new Error(`Invoice ${invoiceId} was not found.`);
  return <InvoiceDetailPage invoice={invoice} />;
}
