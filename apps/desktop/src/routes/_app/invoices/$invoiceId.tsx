import { decodeInvoiceId } from "@store/contracts";
import { preloadInventoryInvoice, useSuspenseInventoryInvoice } from "@store/inventory-react";
import { createFileRoute } from "@tanstack/react-router";

import {
  InvoiceDetailError,
  InvoiceDetailNotFound,
  InvoiceDetailPage,
} from "@/components/invoices/detail-page";
import { preloadInventory } from "@/lib/inventory/preload";

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
