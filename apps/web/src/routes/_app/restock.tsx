import { RESTOCK_VIEWS, type RestockView } from "@store/contracts";
import { preloadRestockPage } from "@store/inventory-react";
import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { InsightsError } from "@/components/insights/insights-error";
import { RESTOCK_PAGE_SIZE } from "@/components/insights/presentation";
import { RestockPage } from "@/components/insights/restock-page";
import { preloadInventory } from "@/lib/inventory/preload";
import { lenientSearchParam } from "@/lib/search-param";

const DEFAULT_VIEW: RestockView = "action";

const restockSearch = Schema.toStandardSchemaV1(
  Schema.Struct({ view: lenientSearchParam(Schema.Literals(RESTOCK_VIEWS)) }),
);

export const Route = createFileRoute("/_app/restock")({
  validateSearch: restockSearch,
  loaderDeps: ({ search }) => ({ view: search.view ?? DEFAULT_VIEW }),
  loader: ({ context, deps }) =>
    preloadInventory(context, (inventory) =>
      preloadRestockPage(inventory, {
        filters: { view: deps.view, search: undefined },
        cursor: null,
        limit: RESTOCK_PAGE_SIZE,
      }),
    ),
  component: RestockRoute,
  errorComponent: InsightsError,
  staticData: { breadcrumb: "Restock" },
});

function RestockRoute() {
  const { view = DEFAULT_VIEW } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <RestockPage
      onViewChange={(next) =>
        void navigate({ search: next === DEFAULT_VIEW ? {} : { view: next }, replace: true })
      }
      view={view}
    />
  );
}
