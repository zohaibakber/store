import { decodeInvoiceId } from "@store/contracts";
import { createFileRoute } from "@tanstack/react-router";

import {
  InvoiceDetailError,
  InvoiceDetailNotFound,
  InvoiceDetailPage,
} from "@/components/invoices/detail-page";
import { preloadInventoryInvoice } from "@/inventory/preload";
import { preloadInventory } from "@/inventory/preload";
import { useSuspenseInventoryInvoice } from "@/inventory/queries";

export const Route = createFileRoute("/_app/invoices/$invoiceId")({
  params: { parse: ({ invoiceId }) => ({ invoiceId: decodeInvoiceId(invoiceId) }) },
  loader: ({ context, params }) =>
    preloadInventory(context, (inventory) => preloadInventoryInvoice(inventory, params.invoiceId)),
  component: InvoiceDetailRoute,
  errorComponent: InvoiceDetailError,
  staticData: { breadcrumb: "Invoice" },
});

function InvoiceDetailRoute() {
  const { invoiceId } = Route.useParams();
  const invoice = useSuspenseInventoryInvoice(invoiceId);
  if (!invoice) return <InvoiceDetailNotFound />;
  return <InvoiceDetailPage invoice={invoice} />;
}
