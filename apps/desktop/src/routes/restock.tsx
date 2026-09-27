import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { InsightsError } from "@/components/insights/insights-error";
import { RESTOCK_VIEWS, RestockPage, type RestockView } from "@/components/insights/restock-page";
import { formValidator } from "@/lib/form-schema";
import { lenientSearchParam } from "@/lib/search-param";

const DEFAULT_VIEW: RestockView = "action";

const restockSearch = formValidator(
  Schema.Struct({ view: lenientSearchParam(Schema.Literals(RESTOCK_VIEWS)) }),
);

export const Route = createFileRoute("/restock")({
  validateSearch: restockSearch,
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
