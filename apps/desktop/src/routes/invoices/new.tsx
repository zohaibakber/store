import { createFileRoute } from "@tanstack/react-router";

import { InvoiceCreatePage } from "@/components/invoices/create-page";
import { useCatalogProducts } from "@/lib/inventory-db";

export const Route = createFileRoute("/invoices/new")({
  component: NewInvoiceRoute,
  staticData: { breadcrumb: "New invoice" },
});

function NewInvoiceRoute() {
  const products = useCatalogProducts();
  if (products.isError && products.data.length === 0) {
    return <p className="p-6 text-sm text-destructive">Could not load products.</p>;
  }
  return <InvoiceCreatePage products={products.data} />;
}
