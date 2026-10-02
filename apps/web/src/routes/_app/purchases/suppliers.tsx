import { preloadSuppliers, useSuspenseSuppliers } from "@store/inventory-react";
import { createFileRoute } from "@tanstack/react-router";

import { SuppliersPage } from "@/components/purchases/suppliers-page";
import { preloadInventory } from "@/lib/inventory/preload";

export const Route = createFileRoute("/_app/purchases/suppliers")({
  loader: ({ context }) => preloadInventory(context, preloadSuppliers),
  component: SuppliersRoute,
  staticData: { breadcrumb: "Suppliers" },
});

function SuppliersRoute() {
  return <SuppliersPage suppliers={useSuspenseSuppliers()} />;
}
