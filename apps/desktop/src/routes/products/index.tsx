import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ProductsTable } from "@/components/product-table";

export const Route = createFileRoute("/products/")({
  loader: () => window.offlineStore.listProducts(),
  component: ProductsPage,
});

function ProductsPage() {
  const products = Route.useLoaderData();

  return (
    <main className="p-4">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <header className="flex items-end justify-between">
          <h1 className="text-lg font-medium tracking-tight">Products</h1>
          <Button render={<Link to="/products/new" />}>
            <HugeiconsIcon aria-hidden="true" icon={Add01Icon} />
            Add product
          </Button>
        </header>
        <ProductsTable products={products} />
      </div>
    </main>
  );
}
