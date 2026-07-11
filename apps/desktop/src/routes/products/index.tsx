import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import {
  PageAction,
  PageContent,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/page-layout";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ProductsTable } from "@/components/product-table";

export const Route = createFileRoute("/products/")({
  loader: () => window.offlineStore.listProducts(),
  component: ProductsPage,
});

function ProductsPage() {
  const products = Route.useLoaderData();

  return (
    <PageLayout>
      <PageHeader>
        <PageHeading>Products</PageHeading>
        <PageAction>
          <Button render={<Link to="/products/new" />}>
            <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
            Add product
          </Button>
        </PageAction>
      </PageHeader>
      <PageContent>
        <ProductsTable products={products} />
      </PageContent>
    </PageLayout>
  );
}
