import { createFileRoute, Link } from "@tanstack/react-router";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  PageAction,
  PageContent,
  PageDescription,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/page-layout";
import { ProductForm, useProductCreateForm } from "@/components/product-form";

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
        <PageDescription>
          Stored locally first and included in the next sync. Prices are in Pakistani rupees.
        </PageDescription>
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

      <PageContent>
        <ProductForm categories={categories} form={form} formId="new-product-form" />
      </PageContent>
    </PageLayout>
  );
}
