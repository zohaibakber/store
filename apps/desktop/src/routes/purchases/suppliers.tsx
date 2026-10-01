import { createFileRoute } from "@tanstack/react-router";

import { SuppliersPage } from "@/components/purchases/suppliers-page";
import { preloadInventory, preloadSuppliers, useSuspenseSuppliers } from "@/lib/inventory";

export const Route = createFileRoute("/purchases/suppliers")({
  loader: ({ context }) => preloadInventory(context, preloadSuppliers),
  component: SuppliersRoute,
  staticData: { breadcrumb: "Suppliers" },
});

function SuppliersRoute() {
  return <SuppliersPage suppliers={useSuspenseSuppliers()} />;
}
