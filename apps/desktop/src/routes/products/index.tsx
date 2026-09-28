import { Add01Icon, Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import * as React from "react";

import { ProductAnalytics } from "@/components/products/analytics";
import { LiveProductInsights } from "@/components/products/insight-cells";
import {
  DEFAULT_PRODUCT_LIST_VIEW,
  PRODUCT_PAGE_SIZES,
  ProductTableFilters,
  useProductsTable,
  type ProductListView,
} from "@/components/products/table";
import {
  DataTable,
  DataTableContent,
  DataTableFilter,
  DataTableFooter,
  DataTablePagination,
  DataTableViewOptions,
} from "@/components/shared/data-table";
import { PageActions } from "@/components/shared/page-actions";
import { PageLayout } from "@/components/shared/page-layout";
import { Button } from "@/components/ui/button";
import { formValidator } from "@/lib/form-schema";
import {
  PRODUCT_SORT_COLUMNS,
  useSuspenseCatalogCategories,
  useSuspenseProductCount,
  useSuspenseProductFacets,
  useSuspenseProductPage,
  type ProductListRequest,
} from "@/lib/inventory";
import { lenientSearchParam } from "@/lib/search-param";
import { cn } from "@/lib/utils";

const Text = Schema.String.check(Schema.isMaxLength(120));

const productsSearch = formValidator(
  Schema.Struct({
    q: lenientSearchParam(Text),
    category: lenientSearchParam(Text),
    aisle: lenientSearchParam(Text),
    composition: lenientSearchParam(Text),
    strength: lenientSearchParam(Text),
    sort: lenientSearchParam(Schema.Literals(PRODUCT_SORT_COLUMNS)),
    desc: lenientSearchParam(Schema.Boolean),
    page: lenientSearchParam(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
    size: lenientSearchParam(Schema.Literals(PRODUCT_PAGE_SIZES)),
  }),
);

export const Route = createFileRoute("/products/")({
  validateSearch: productsSearch,
  component: ProductsPage,
});

const requestFor = (view: ProductListView): ProductListRequest => ({
  filters: {
    search: view.q,
    categoryId: view.category,
    aisle: view.aisle,
    composition: view.composition,
    strength: view.strength,
  },
  sort: { column: view.sort, direction: view.desc ? "desc" : "asc" },
  pageIndex: view.page,
  pageSize: view.size,
});

const searchFor = (view: ProductListView) => ({
  q: view.q || undefined,
  category: view.category,
  aisle: view.aisle,
  composition: view.composition,
  strength: view.strength,
  sort: view.sort === DEFAULT_PRODUCT_LIST_VIEW.sort ? undefined : view.sort,
  desc: view.desc || undefined,
  page: view.page || undefined,
  size: view.size === DEFAULT_PRODUCT_LIST_VIEW.size ? undefined : view.size,
});

function ProductsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view = React.useMemo<ProductListView>(
    () => ({
      ...DEFAULT_PRODUCT_LIST_VIEW,
      q: search.q,
      category: search.category,
      aisle: search.aisle,
      composition: search.composition,
      strength: search.strength,
      sort: search.sort ?? DEFAULT_PRODUCT_LIST_VIEW.sort,
      desc: search.desc ?? DEFAULT_PRODUCT_LIST_VIEW.desc,
      page: search.page ?? DEFAULT_PRODUCT_LIST_VIEW.page,
      size: search.size ?? DEFAULT_PRODUCT_LIST_VIEW.size,
    }),
    [search],
  );
  const request = React.useMemo(() => requestFor(view), [view]);
  const shownRequest = React.useDeferredValue(request);
  return (
    <ProductsContent
      loading={request !== shownRequest}
      onViewChange={(next) => void navigate({ search: searchFor(next), replace: true })}
      request={shownRequest}
      view={view}
    />
  );
}

function ProductsContent({
  loading,
  onViewChange,
  request,
  view,
}: {
  readonly loading: boolean;
  readonly onViewChange: (view: ProductListView) => void;
  readonly request: ProductListRequest;
  readonly view: ProductListView;
}) {
  const navigate = useNavigate();
  const categories = useSuspenseCatalogCategories();
  const facets = useSuspenseProductFacets();
  const page = useSuspenseProductPage(request);
  const total = useSuspenseProductCount(request.filters);
  const rows = React.useMemo(() => {
    const names = new Map(categories.map((category) => [category.id, category.name]));
    return page.map((product) => ({
      ...product,
      categoryName: names.get(product.categoryId) ?? "Uncategorized",
    }));
  }, [categories, page]);
  const table = useProductsTable({ rows, total, view, categories, onViewChange });

  return (
    <DataTable
      onRowClick={(row) => navigate({ to: "/products/$productId", params: { productId: row.id } })}
      table={table}
    >
      <PageActions>
        <DataTableFilter columnId="name" placeholder="Search products" />
        <ProductTableFilters categories={categories} facets={facets} />
        <DataTableViewOptions />
        <Button render={<Link to="/products/upload" />} size="sm" variant="outline">
          <HugeiconsIcon aria-hidden="true" icon={Upload01Icon} />
          Import
        </Button>
        <Button render={<Link to="/products/new" />} size="sm">
          <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
          Add product
        </Button>
      </PageActions>
      <PageLayout>
        <ProductAnalytics />
        <div aria-busy={loading} className={cn("transition-opacity", loading && "opacity-60")}>
          <LiveProductInsights>
            <DataTableContent>
              <DataTableFooter>
                <DataTablePagination />
              </DataTableFooter>
            </DataTableContent>
          </LiveProductInsights>
        </div>
      </PageLayout>
    </DataTable>
  );
}
