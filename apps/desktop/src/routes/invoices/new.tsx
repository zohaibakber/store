import { createFileRoute } from "@tanstack/react-router";

import { InvoiceCreatePage } from "@/components/invoices/create-page";

export const Route = createFileRoute("/invoices/new")({
  component: NewInvoiceRoute,
  staticData: { breadcrumb: "New invoice" },
});

function NewInvoiceRoute() {
  return <InvoiceCreatePage />;
}
