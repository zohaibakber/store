import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { InvoiceCreatePage } from "@/components/invoices/create-page";
import { formValidator } from "@/lib/form-schema";
import {
  preloadAll,
  preloadCatalogProductsById,
  preloadInventory,
  preloadProductSearch,
} from "@/lib/inventory";
import { saleDraftsAtom } from "@/lib/preferences";
import { SALE_SEARCH_LIMIT, saleProductIds } from "@/lib/sale-drafts";
import { lenientSearchParam } from "@/lib/search-param";
import { workspaceStorageKey } from "@/lib/workspace";
import { publishedWorkspaceSnapshot } from "@/session/workspace-session";

const newInvoiceSearch = formValidator(
  Schema.Struct({ add: lenientSearchParam(Schema.NonEmptyString) }),
);

export const Route = createFileRoute("/_app/invoices/new")({
  validateSearch: newInvoiceSearch,
  loader: ({ context }) => {
    const workspace = context.access.workspace(
      publishedWorkspaceSnapshot(context.session.current()),
    );
    const drafts = context.registry.get(saleDraftsAtom(workspaceStorageKey(workspace)));
    return preloadInventory(context, (inventory) =>
      preloadAll([
        preloadCatalogProductsById(inventory, saleProductIds(drafts)),
        preloadProductSearch(inventory, "", SALE_SEARCH_LIMIT),
      ]),
    );
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
