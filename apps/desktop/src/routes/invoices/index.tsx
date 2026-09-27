import { createFileRoute } from "@tanstack/react-router";

import { InvoicesPage } from "@/components/invoices/page";
import { useSuspenseInventoryInvoices } from "@/lib/inventory";

export const Route = createFileRoute("/invoices/")({
  component: InvoicesRoute,
});

function InvoicesRoute() {
  return <InvoicesPage invoices={useSuspenseInventoryInvoices()} />;
}
