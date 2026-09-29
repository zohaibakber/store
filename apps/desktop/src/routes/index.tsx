import { SALES_RANGES, type SalesRange } from "@store/services/insights";
import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { InsightsError } from "@/components/insights/insights-error";
import { OverviewPage } from "@/components/insights/overview-page";
import { RECENT_INVOICE_LIMIT } from "@/components/insights/recent-invoices";
import { formValidator } from "@/lib/form-schema";
import {
  preloadAll,
  preloadInventory,
  preloadInventoryInsights,
  preloadInventoryInvoices,
} from "@/lib/inventory";
import { lenientSearchParam } from "@/lib/search-param";

const DEFAULT_RANGE: SalesRange = 30;

const overviewSearch = formValidator(
  Schema.Struct({ range: lenientSearchParam(Schema.Literals(SALES_RANGES)) }),
);

export const Route = createFileRoute("/")({
  validateSearch: overviewSearch,
  loader: ({ context }) =>
    preloadInventory(context, (inventory) =>
      preloadAll([
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
