import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import * as React from "react";

import { ProductAnalytics } from "@/components/products/analytics";
import type { ProductListView } from "@/components/products/list";
import { ProductTableFilters, useProductsTable } from "@/components/products/table";
import { DataTable, DataTableFilter, DataTableViewOptions } from "@/components/shared/data-table";
import { ListTableContent } from "@/components/shared/list-view";
import { PageLayout, PageToolbar, PageHeading } from "@/components/shared/page-layout";
import { Button } from "@/components/ui/button";
import type { ProductListRequest } from "@/inventory/product-list";
import {
  useSuspenseCatalogCategories,
  useSuspenseProductCount,
  useSuspenseProductFacets,
  useSuspenseProductPage,
} from "@/inventory/queries";
import { useStaffPermission } from "@/inventory/staff";

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
  const canManageStock = useStaffPermission("manageStock");
  const canViewReports = useStaffPermission("viewReports");
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
  const table = useProductsTable({
    rows,
    total,
    view,
    categories,
    onViewChange,
    loading,
    hasAisles: facets.aisle.length > 0,
  });

  return (
    <DataTable
      onRowClick={(row) =>
        navigate({ to: "/products/$productId", params: { productId: row.original.id } })
      }
      onRowPreload={(row) =>
        void router.preloadRoute({
          to: "/products/$productId",
          params: { productId: row.original.id },
        })
      }
      table={table}
    >
      <PageLayout>
        <PageToolbar>
          <PageHeading className="me-2 shrink-0">Products</PageHeading>
          <DataTableFilter className="me-auto" columnId="name" placeholder="Search products" />
          <ProductTableFilters categories={categories} facets={facets} />
          <DataTableViewOptions />
          {canManageStock ? (
            <>
              <Button render={<Link to="/products/new" />} size="sm">
                <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
                Add product
              </Button>
            </>
          ) : null}
        </PageToolbar>
        {canViewReports ? <ProductAnalytics /> : null}
        <ListTableContent loading={loading} />
      </PageLayout>
    </DataTable>
  );
}
