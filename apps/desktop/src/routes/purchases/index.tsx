import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import * as React from "react";

import { PurchaseOrdersPage } from "@/components/purchases/orders-page";
import {
  DEFAULT_PURCHASE_ORDER_LIST_VIEW,
  PURCHASE_ORDER_PAGE_SIZES,
  supplierIdsMatching,
  supplierNamesOf,
  type PurchaseOrderListView,
} from "@/components/purchases/presentation";
import { formValidator } from "@/lib/form-schema";
import {
  PURCHASE_ORDER_SORT_COLUMNS,
  PURCHASE_ORDER_TABS,
  preloadAll,
  preloadInventory,
  preloadPurchaseOrderList,
  preloadPurchaseOrderTabs,
  preloadSuppliers,
  useSuspenseSuppliers,
  type PurchaseOrderListRequest,
} from "@/lib/inventory";
import { lenientSearchParam } from "@/lib/search-param";

const PurchasesSearch = Schema.Struct({
  tab: lenientSearchParam(Schema.Literals(PURCHASE_ORDER_TABS)),
  new: lenientSearchParam(Schema.Boolean),
  q: lenientSearchParam(Schema.String.check(Schema.isMaxLength(120))),
  sort: lenientSearchParam(Schema.Literals(PURCHASE_ORDER_SORT_COLUMNS)),
  desc: lenientSearchParam(Schema.Boolean),
  page: lenientSearchParam(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  size: lenientSearchParam(Schema.Literals(PURCHASE_ORDER_PAGE_SIZES)),
});

type PurchasesSearch = typeof PurchasesSearch.Type;

const purchasesSearch = formValidator(PurchasesSearch);

const viewFor = (search: PurchasesSearch): PurchaseOrderListView => ({
  tab: search.tab ?? DEFAULT_PURCHASE_ORDER_LIST_VIEW.tab,
  q: search.q,
  sort: search.sort ?? DEFAULT_PURCHASE_ORDER_LIST_VIEW.sort,
  desc: search.desc ?? DEFAULT_PURCHASE_ORDER_LIST_VIEW.desc,
  page: search.page ?? DEFAULT_PURCHASE_ORDER_LIST_VIEW.page,
  size: search.size ?? DEFAULT_PURCHASE_ORDER_LIST_VIEW.size,
});

const requestFor = (
  view: PurchaseOrderListView,
  supplierIds: ReadonlyArray<string> | undefined,
): PurchaseOrderListRequest => ({
  filters: supplierIds === undefined ? { tab: view.tab } : { tab: view.tab, supplierIds },
  sort: { column: view.sort, direction: view.desc ? "desc" : "asc" },
  pageIndex: view.page,
  pageSize: view.size,
});

const searchFor = (view: PurchaseOrderListView, builderOpen: boolean) => ({
  tab: view.tab === DEFAULT_PURCHASE_ORDER_LIST_VIEW.tab ? undefined : view.tab,
  new: builderOpen || undefined,
  q: view.q || undefined,
  sort: view.sort === DEFAULT_PURCHASE_ORDER_LIST_VIEW.sort ? undefined : view.sort,
  desc: view.desc === DEFAULT_PURCHASE_ORDER_LIST_VIEW.desc ? undefined : view.desc,
  page: view.page || undefined,
  size: view.size === DEFAULT_PURCHASE_ORDER_LIST_VIEW.size ? undefined : view.size,
});

export const Route = createFileRoute("/purchases/")({
  validateSearch: purchasesSearch,
  loaderDeps: ({ search }) => ({ tab: search.tab ?? DEFAULT_PURCHASE_ORDER_LIST_VIEW.tab }),
  loader: ({ context, location }) =>
    preloadInventory(context, (inventory) => {
      const view = viewFor(location.search);
      return view.q?.trim()
        ? preloadAll([preloadSuppliers(inventory), preloadPurchaseOrderTabs(inventory)])
        : preloadPurchaseOrderList(inventory, requestFor(view, undefined));
    }),
  component: PurchasesRoute,
});

function PurchasesRoute() {
  const { tab, new: builderOpen = false, q, sort, desc, page, size } = Route.useSearch();
  const navigate = Route.useNavigate();
  const view = React.useMemo(
    () => viewFor({ tab, q, sort, desc, page, size }),
    [tab, q, sort, desc, page, size],
  );
  const suppliers = useSuspenseSuppliers();
  const supplierNames = React.useMemo(() => supplierNamesOf(suppliers), [suppliers]);
  const supplierIds = React.useMemo(() => supplierIdsMatching(suppliers, q), [suppliers, q]);
  const request = React.useMemo(() => requestFor(view, supplierIds), [view, supplierIds]);
  const shownRequest = React.useDeferredValue(request);
  return (
    <PurchaseOrdersPage
      builderOpen={builderOpen}
      loading={request !== shownRequest}
      onBuilderOpenChange={(open) =>
        void navigate({ search: searchFor(view, open), replace: true })
      }
      onViewChange={(next) =>
        void navigate({ search: searchFor(next, builderOpen), replace: true })
      }
      request={shownRequest}
      supplierNames={supplierNames}
      view={view}
    />
  );
}
