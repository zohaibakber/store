import { SALES_RANGES, type SalesRange } from "@store/services/insights";
import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { InsightsError } from "@/components/insights/insights-error";
import { OverviewPage } from "@/components/insights/overview-page";
import { formValidator } from "@/lib/form-schema";
import { lenientSearchParam } from "@/lib/search-param";

const DEFAULT_RANGE: SalesRange = 30;

const overviewSearch = formValidator(
  Schema.Struct({ range: lenientSearchParam(Schema.Literals(SALES_RANGES)) }),
);

export const Route = createFileRoute("/")({
  validateSearch: overviewSearch,
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
