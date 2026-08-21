import { InvoiceId } from "@store/contracts/ids";
import { formatInvoiceNumber } from "@store/contracts/store-helpers";
import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { InvoiceDetailError, InvoiceDetailPage } from "@/components/invoices/detail-page";

export const Route = createFileRoute("/invoices/$invoiceId")({
  loader: ({ context, params }) =>
    context.store.getInvoice({ id: Schema.decodeUnknownSync(InvoiceId)(params.invoiceId) }),
  component: InvoiceDetailRoute,
  errorComponent: InvoiceDetailError,
  staticData: {
    breadcrumb: (loaderData) =>
      loaderData && "invoiceNumber" in loaderData
        ? `Invoice #${formatInvoiceNumber(loaderData.invoiceNumber)}`
        : "Invoice",
  },
});

function InvoiceDetailRoute() {
  return <InvoiceDetailPage invoice={Route.useLoaderData()} />;
}
