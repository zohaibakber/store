import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import * as React from "react";

import { PurchaseOrdersPage } from "@/components/purchases/orders-page";
import { supplierNamesOf } from "@/components/purchases/presentation";
import { formValidator } from "@/lib/form-schema";
import {
  PURCHASE_ORDER_TABS,
  preloadInventory,
  preloadPurchaseOrders,
  useSuspensePurchaseOrderHistory,
  useSuspenseSuppliers,
  type PurchaseOrderTab,
} from "@/lib/inventory";
import { lenientSearchParam } from "@/lib/search-param";

const DEFAULT_TAB: PurchaseOrderTab = "open";

const purchasesSearch = formValidator(
  Schema.Struct({
    tab: lenientSearchParam(Schema.Literals(PURCHASE_ORDER_TABS)),
    new: lenientSearchParam(Schema.Boolean),
  }),
);

export const Route = createFileRoute("/purchases/")({
  validateSearch: purchasesSearch,
  loaderDeps: ({ search }) => ({ tab: search.tab ?? DEFAULT_TAB }),
  loader: ({ context, deps }) =>
    preloadInventory(context, (inventory) => preloadPurchaseOrders(inventory, deps.tab)),
  component: PurchasesRoute,
});

const searchFor = (tab: PurchaseOrderTab, builderOpen: boolean) => ({
  tab: tab === DEFAULT_TAB ? undefined : tab,
  new: builderOpen || undefined,
});

function PurchasesRoute() {
  const { tab = DEFAULT_TAB, new: builderOpen = false } = Route.useSearch();
  const navigate = Route.useNavigate();
  const shownTab = React.useDeferredValue(tab);
  const history = useSuspensePurchaseOrderHistory(shownTab);
  const suppliers = useSuspenseSuppliers();
  const supplierNames = React.useMemo(() => supplierNamesOf(suppliers), [suppliers]);
  return (
    <PurchaseOrdersPage
      builderOpen={builderOpen}
      hasMore={history.hasNextPage}
      loadingMore={history.isFetchingNextPage}
      onBuilderOpenChange={(open) => void navigate({ search: searchFor(tab, open), replace: true })}
      onLoadMore={() => void history.fetchNextPage()}
      onTabChange={(next) => void navigate({ search: searchFor(next, false), replace: true })}
      orders={history.data}
      supplierNames={supplierNames}
      shownTab={shownTab}
      tab={tab}
    />
  );
}
