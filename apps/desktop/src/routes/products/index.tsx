import { Add01Icon, Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { ProductAnalytics } from "@/components/products/analytics";
import { ProductTableFilters, useProductsTable } from "@/components/products/table";
import {
  DataTable,
  DataTableContent,
  DataTableFooter,
  DataTablePagination,
  DataTableViewOptions,
} from "@/components/shared/data-table";
import {
  PageAction,
  PageContent,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/shared/page-layout";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/products/")({
  loader: ({ context }) => context.store.listProducts(),
  component: ProductsPage,
});

function ProductsPage() {
  const products = Route.useLoaderData();
  const navigate = useNavigate();
  const table = useProductsTable(products);

  return (
    <DataTable
      onRowClick={(row) => navigate({ to: "/products/$productId", params: { productId: row.id } })}
      table={table}
    >
      <PageLayout contentClassName="gap-4">
        <PageHeader>
          <PageHeading>Products</PageHeading>
          <PageAction className="flex items-center gap-2">
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
          <ProductTableFilters products={products} />
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
