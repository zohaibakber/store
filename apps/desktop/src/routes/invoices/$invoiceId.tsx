import { createFileRoute } from "@tanstack/react-router";

import { InvoiceDetailError, InvoiceDetailPage } from "@/components/invoices/detail-page";
import {
  preloadInventory,
  preloadInventoryInvoice,
  useSuspenseInventoryInvoice,
} from "@/lib/inventory";

export const Route = createFileRoute("/invoices/$invoiceId")({
  loader: ({ context, params }) =>
    preloadInventory(context, (inventory) => preloadInventoryInvoice(inventory, params.invoiceId)),
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
