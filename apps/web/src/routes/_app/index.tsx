import { SALES_RANGE_DAYS, type SalesRange } from "@store/contracts";
import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { InsightsError } from "@/components/insights/insights-error";
import { OverviewPage } from "@/components/insights/overview-page";
import { RECENT_INVOICE_LIMIT } from "@/components/insights/presentation";
import { formValidator } from "@/lib/form-schema";
import {
  preloadAll,
  preloadInventory,
  preloadInventoryInsights,
  preloadInventoryInvoices,
} from "@/lib/inventory";
import { preloadCatalogIsEmpty } from "@/lib/inventory/catalog-empty";
import { lenientSearchParam } from "@/lib/search-param";

const DEFAULT_RANGE: SalesRange = 30;

const overviewSearch = formValidator(
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
