import { createFileRoute, Link } from "@tanstack/react-router";

import { ProductForm, useProductCreateForm } from "@/components/products/form";
import { FrameCard } from "@/components/shared/frame-card";
import { PageContent, PageLayout } from "@/components/shared/page-layout";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/products/new")({
  loader: ({ context }) => context.store.listCategories(),
  component: NewProductPage,
  staticData: { breadcrumb: "Add product" },
});

function NewProductPage() {
  const categories = Route.useLoaderData();
  const form = useProductCreateForm(categories);

  return (
    <PageLayout contentClassName="max-w-3xl">
      <PageContent>
        <FrameCard
          action={
            <div className="flex items-center gap-2">
              <Button render={<Link to="/products" />} size="sm" variant="outline">
                Cancel
              </Button>
              <form.Subscribe selector={(state) => state.canSubmit}>
                {(canSubmit) => (
                  <Button disabled={!canSubmit} form="new-product-form" size="sm" type="submit">
                    Create product
                  </Button>
                )}
              </form.Subscribe>
            </div>
          }
          title={<h1 className="font-medium">Add product</h1>}
        >
          <ProductForm categories={categories} form={form} formId="new-product-form" />
        </FrameCard>
      </PageContent>
    </PageLayout>
  );
}
