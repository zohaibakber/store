import { Add01Icon, Alert02Icon, Upload01Icon } from "@hugeicons/core-free-icons";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useCatalogProducts } from "@/lib/inventory-db";

export const Route = createFileRoute("/products/")({
  component: ProductsPage,
});

function ProductsPage() {
  const live = useCatalogProducts();
  if (live.isError && live.data.length === 0) {
    return <ProductsStatus error message="The catalog could not be loaded." />;
  }
  return <ProductsContent products={live.data} />;
}

function ProductsStatus({ error = false, message }: { error?: boolean; message: string }) {
  return (
    <PageLayout contentClassName="gap-4">
      <PageHeader>
        <PageHeading>Products</PageHeading>
      </PageHeader>
      <PageContent>
        {error ? (
          <Alert variant="error">
            <HugeiconsIcon aria-hidden="true" icon={Alert02Icon} />
            <AlertTitle>Could not load products</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : (
          <p className="text-sm text-muted-foreground">{message}</p>
        )}
      </PageContent>
    </PageLayout>
  );
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
