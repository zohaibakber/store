import { preloadProductList, type ProductListRequest } from "@store/inventory-react";
import { createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import * as React from "react";

import { productList, type ProductListView } from "@/components/products/list";
import { ProductsPage } from "@/components/products/page";
import { useShownRequest } from "@/components/shared/list-view";
import { preloadInventory } from "@/lib/inventory/preload";
import { ListSearchText } from "@/lib/list-view";
import { lenientSearchParam } from "@/lib/search-param";

const ProductsSearch = Schema.Struct({
  ...productList.searchFields,
  category: lenientSearchParam(ListSearchText),
  aisle: lenientSearchParam(ListSearchText),
  composition: lenientSearchParam(ListSearchText),
  strength: lenientSearchParam(ListSearchText),
});

const productsSearch = Schema.toStandardSchemaV1(ProductsSearch);

const viewFor = (search: typeof ProductsSearch.Type): ProductListView => ({
  ...productList.viewOf(search),
  category: search.category,
  aisle: search.aisle,
  composition: search.composition,
  strength: search.strength,
});

const requestFor = (view: ProductListView): ProductListRequest => ({
  filters: {
    search: view.q,
    categoryId: view.category,
    aisle: view.aisle,
    composition: view.composition,
    strength: view.strength,
  },
  ...productList.requestPage(view),
});

const searchFor = (view: ProductListView) => {
  const { q, ...paging } = productList.searchOf(view);
  return {
    q,
    category: view.category,
    aisle: view.aisle,
    composition: view.composition,
    strength: view.strength,
    ...paging,
  };
};

export const Route = createFileRoute("/_app/products/")({
  validateSearch: productsSearch,
  loader: ({ context, location }) =>
    preloadInventory(context, (inventory) =>
      preloadProductList(inventory, requestFor(viewFor(location.search))),
    ),
  component: ProductsRoute,
});

function ProductsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view = React.useMemo(() => viewFor(search), [search]);
  const { request, loading } = useShownRequest(React.useMemo(() => requestFor(view), [view]));
  return (
    <ProductsPage
      loading={loading}
      onViewChange={(next) => void navigate({ search: searchFor(next), replace: true })}
      request={request}
      view={view}
    />
  );
}
