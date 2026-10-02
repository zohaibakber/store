import { Add01Icon, Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  useSuspenseCatalogCategories,
  useSuspenseProductCount,
  useSuspenseProductFacets,
  useSuspenseProductPage,
  type ProductListRequest,
} from "@store/inventory-react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import * as React from "react";

import { ProductAnalytics } from "@/components/products/analytics";
import type { ProductListView } from "@/components/products/list";
import { ProductTableFilters, useProductsTable } from "@/components/products/table";
import { DataTable, DataTableFilter, DataTableViewOptions } from "@/components/shared/data-table";
import { ListTableContent } from "@/components/shared/list-view";
import { PageLayout, PageToolbar } from "@/components/shared/page-layout";
import { Button } from "@/components/ui/button";

export function ProductsPage({
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
  const router = useRouter();
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
  const table = useProductsTable({ rows, total, view, categories, onViewChange, loading });

  return (
    <DataTable
      onRowClick={(row) => navigate({ to: "/products/$productId", params: { productId: row.id } })}
      onRowPreload={(row) =>
        void router.preloadRoute({ to: "/products/$productId", params: { productId: row.id } })
      }
      table={table}
    >
      <PageLayout>
        <PageToolbar>
          <DataTableFilter className="me-auto" columnId="name" placeholder="Search products" />
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
        </PageToolbar>
        <ProductAnalytics />
        <ListTableContent loading={loading} />
      </PageLayout>
    </DataTable>
  );
}
