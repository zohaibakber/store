import {
  PURCHASE_ORDER_TABS,
  preloadAll,
  preloadPurchaseOrderList,
  preloadPurchaseOrderTabs,
  preloadSuppliers,
  useSuspenseSuppliers,
  type PurchaseOrderListRequest,
} from "@store/inventory-react";
import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import * as React from "react";

import {
  DEFAULT_PURCHASE_ORDER_TAB,
  purchaseOrderList,
  type PurchaseOrderListView,
} from "@/components/purchases/order-list";
import { PurchaseOrdersPage } from "@/components/purchases/orders-page";
import { supplierIdsMatching, supplierNamesOf } from "@/components/purchases/presentation";
import { useShownRequest } from "@/components/shared/list-view";
import { preloadInventory } from "@/lib/inventory/preload";
import { lenientSearchParam } from "@/lib/search-param";

const PurchasesSearch = Schema.Struct({
  tab: lenientSearchParam(Schema.Literals(PURCHASE_ORDER_TABS)),
  new: lenientSearchParam(Schema.Boolean),
  ...purchaseOrderList.searchFields,
});

type PurchasesSearch = typeof PurchasesSearch.Type;

const purchasesSearch = Schema.toStandardSchemaV1(PurchasesSearch);

const viewFor = (search: PurchasesSearch): PurchaseOrderListView => ({
  tab: search.tab ?? DEFAULT_PURCHASE_ORDER_TAB,
  ...purchaseOrderList.viewOf(search),
});

const requestFor = (
  view: PurchaseOrderListView,
  supplierIds: ReadonlyArray<string> | undefined,
): PurchaseOrderListRequest => ({
  filters: supplierIds === undefined ? { tab: view.tab } : { tab: view.tab, supplierIds },
  ...purchaseOrderList.requestPage(view),
});

const searchFor = (view: PurchaseOrderListView, builderOpen: boolean) => ({
  tab: view.tab === DEFAULT_PURCHASE_ORDER_TAB ? undefined : view.tab,
  new: builderOpen || undefined,
  ...purchaseOrderList.searchOf(view),
});

export const Route = createFileRoute("/_app/purchases/")({
  validateSearch: purchasesSearch,
  loaderDeps: ({ search }) => ({ tab: search.tab ?? DEFAULT_PURCHASE_ORDER_TAB }),
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
  const { request, loading } = useShownRequest(
    React.useMemo(() => requestFor(view, supplierIds), [view, supplierIds]),
  );
  return (
    <PurchaseOrdersPage
      builderOpen={builderOpen}
      loading={loading}
      onBuilderOpenChange={(open) =>
        void navigate({ search: searchFor(view, open), replace: true })
      }
      onViewChange={(next) =>
        void navigate({ search: searchFor(next, builderOpen), replace: true })
      }
      request={request}
      supplierNames={supplierNames}
      view={view}
    />
  );
}
