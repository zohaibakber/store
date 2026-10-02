import { SALES_RANGE_DAYS, type SalesRange } from "@store/contracts";
import {
  preloadAll,
  preloadInventoryInsights,
  preloadInventoryInvoices,
} from "@store/inventory-react";
import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { InsightsError } from "@/components/insights/insights-error";
import { OverviewPage } from "@/components/insights/overview-page";
import { RECENT_INVOICE_LIMIT } from "@/components/insights/presentation";
import { preloadCatalogIsEmpty } from "@/lib/inventory/catalog-empty";
import { preloadInventory } from "@/lib/inventory/preload";
import { lenientSearchParam } from "@/lib/search-param";

const DEFAULT_RANGE: SalesRange = 30;

const overviewSearch = Schema.toStandardSchemaV1(
  Schema.Struct({ range: lenientSearchParam(Schema.Literals(SALES_RANGE_DAYS)) }),
);

export const Route = createFileRoute("/_app/")({
  validateSearch: overviewSearch,
  loader: ({ context }) =>
    preloadInventory(context, (inventory) =>
      preloadAll([
        preloadCatalogIsEmpty(inventory),
        preloadInventoryInsights(inventory),
        preloadInventoryInvoices(inventory, RECENT_INVOICE_LIMIT),
      ]),
    ),
  component: OverviewRoute,
  errorComponent: InsightsError,
});

function OverviewRoute() {
  const { range = DEFAULT_RANGE } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <OverviewPage
      onRangeChange={(next) =>
        void navigate({ search: next === DEFAULT_RANGE ? {} : { range: next }, replace: true })
      }
      range={range}
    />
  );
}
