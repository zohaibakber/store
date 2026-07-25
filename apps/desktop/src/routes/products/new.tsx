import { createFileRoute, Link } from "@tanstack/react-router";

import {
  PageAction,
  PageContent,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/page-layout";
import { ProductForm, useProductCreateForm } from "@/components/products/form";
import { Button, buttonVariants } from "@/components/ui/button";

export const Route = createFileRoute("/products/new")({
  loader: () => window.offlineStore.listCategories(),
  component: NewProductPage,
});

function NewProductPage() {
  const categories = Route.useLoaderData();
  const form = useProductCreateForm(categories);

  return (
    <PageLayout contentClassName="max-w-3xl">
      <PageHeader>
        <PageHeading>Add product</PageHeading>
        <PageAction className="flex items-center gap-2">
          <Link className={buttonVariants({ variant: "outline" })} to="/products">
            Cancel
          </Link>
          <form.Subscribe selector={(state) => state.canSubmit}>
            {(canSubmit) => (
              <Button disabled={!canSubmit} form="new-product-form" type="submit">
                Create product
              </Button>
            )}
          </form.Subscribe>
        </PageAction>
      </PageHeader>

      <PageContent className="mt-4">
        <ProductForm categories={categories} form={form} formId="new-product-form" />
      </PageContent>
    </PageLayout>
  );
}
