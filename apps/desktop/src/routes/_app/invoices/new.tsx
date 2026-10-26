import { ProductId } from "@store/contracts";
import {
  preloadAll,
  preloadCatalogProductsById,
  preloadProductSearch,
} from "@store/inventory-react";
import { createFileRoute } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { InvoiceCreatePage } from "@/components/invoices/create-page";
import { preloadInventory } from "@/lib/inventory/preload";
import { saleDraftsAtom } from "@/lib/preferences";
import { SALE_SEARCH_LIMIT, saleDraftOwner, saleProductIds } from "@/lib/sale-drafts";
import { lenientSearchParam } from "@/lib/search-param";
import { workspaceStorageKey } from "@/lib/workspace";
import { workspaceSessionAtom } from "@/session/workspace-session";

const newInvoiceSearch = Schema.toStandardSchemaV1(
  Schema.Struct({ add: lenientSearchParam(ProductId) }),
);

export const Route = createFileRoute("/_app/invoices/new")({
  validateSearch: newInvoiceSearch,
  loader: ({ context }) => {
    const workspace = context.access.workspace(context.registry.get(workspaceSessionAtom).snapshot);
    return preloadInventory(context, (inventory) => {
      const staff = inventory.atoms.registry.get(inventory.atoms.staff);
      const owner = saleDraftOwner(workspaceStorageKey(workspace), Option.getOrUndefined(staff));
      const drafts = context.registry.get(saleDraftsAtom(owner));
      return preloadAll([
        preloadCatalogProductsById(inventory, saleProductIds(drafts)),
        preloadProductSearch(inventory, "", SALE_SEARCH_LIMIT),
      ]);
    });
  },
  component: NewInvoiceRoute,
  staticData: { breadcrumb: "New sale" },
});

function NewInvoiceRoute() {
  const { add } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <InvoiceCreatePage
      addProductId={add}
      onProductAdded={() => void navigate({ search: {}, replace: true })}
    />
  );
}
