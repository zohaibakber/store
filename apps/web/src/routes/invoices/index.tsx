import { createFileRoute } from "@tanstack/react-router";

import { InvoicesPage } from "@/components/invoices/page";
import { useInventoryInvoices } from "@/lib/inventory-db";

export const Route = createFileRoute("/invoices/")({
  component: InvoicesRoute,
});

function InvoicesRoute() {
  const invoices = useInventoryInvoices();
  if (invoices.isError && invoices.data.length === 0) {
    return <p className="p-6 text-sm text-destructive">Could not load invoices.</p>;
  }
  return <InvoicesPage invoices={invoices.data} />;
}
