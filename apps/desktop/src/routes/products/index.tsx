import { Add01Icon, Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import {
  DataTable,
  DataTableContent,
  DataTableFilter,
  DataTableFooter,
  DataTablePagination,
  DataTableViewOptions,
} from "@/components/data-table";
import {
  PageAction,
  PageContent,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/page-layout";
import { ProductAnalytics } from "@/components/products/analytics";
import { useProductsTable } from "@/components/products/table";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/products/")({
  loader: () => window.offlineStore.listProducts(),
  component: ProductsPage,
});

function ProductsPage() {
  const products = Route.useLoaderData();
  const navigate = useNavigate();
  const table = useProductsTable(products);

  // The provider wraps the whole page so the search box and column toggles can
  // sit in the page header while still reaching the table's context.
  return (
    <DataTable
      onRowClick={(row) => navigate({ to: "/products/$productId", params: { productId: row.id } })}
      table={table}
    >
      <PageLayout contentClassName="gap-4">
        <PageHeader>
          <PageHeading>Products</PageHeading>
          <PageAction className="flex items-center gap-2">
            <DataTableFilter columnId="name" placeholder="Search products" />
            <DataTableViewOptions className="ml-0" />
            <Button
              aria-label="Import products"
              render={<Link to="/products/upload" />}
              size="icon"
              variant="outline"
            >
              <HugeiconsIcon aria-hidden="true" icon={Upload01Icon} />
            </Button>
            <Button render={<Link to="/products/new" />}>
              <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
              Add product
            </Button>
          </PageAction>
        </PageHeader>
        <PageContent>
          <ProductAnalytics products={products} />
          <DataTableContent>
            <DataTableFooter>
              <DataTablePagination />
            </DataTableFooter>
          </DataTableContent>
        </PageContent>
      </PageLayout>
    </DataTable>
  );
}
