import { createFileRoute } from "@tanstack/react-router";

import { SuppliersPage } from "@/components/purchases/suppliers-page";
import { preloadSuppliers } from "@/inventory/preload";
import { preloadInventory } from "@/inventory/preload";
import { useSuspenseSuppliers } from "@/inventory/purchasing-queries";

export const Route = createFileRoute("/_app/suppliers")({
  loader: ({ context }) => preloadInventory(context, preloadSuppliers),
  component: SuppliersRoute,
  staticData: { breadcrumb: "Suppliers" },
});

function SuppliersRoute() {
  return <SuppliersPage suppliers={useSuspenseSuppliers()} />;
}
