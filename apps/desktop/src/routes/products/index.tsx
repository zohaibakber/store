import { Add01Icon, Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Product } from "@store/contracts";
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
import { useSuspenseCatalogProducts } from "@/lib/inventory";

export const Route = createFileRoute("/products/")({
  component: ProductsPage,
});

function ProductsPage() {
  return <ProductsContent products={useSuspenseCatalogProducts()} />;
}

function ProductsContent({ products }: { readonly products: ReadonlyArray<Product> }) {
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
            <ProductTableFilters products={products} />
            <DataTableViewOptions className="ml-0" />
            <Button render={<Link to="/products/upload" />} variant="outline">
              <HugeiconsIcon aria-hidden="true" icon={Upload01Icon} />
              Import
            </Button>
            <Button render={<Link to="/products/new" />}>
              <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
              Add product
            </Button>
          </PageAction>
        </PageHeader>
        <PageContent>
          <ProductAnalytics />
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
