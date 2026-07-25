import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";

import { ProductForm, useProductUpdateForm } from "@/components/products/form";
import {
  PageAction,
  PageContent,
  PageDescription,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/shared/page-layout";
import { Button, buttonVariants } from "@/components/ui/button";

export const Route = createFileRoute("/products/$productId_/edit")({
  loader: async ({ context, params }) => {
    const [product, categories] = await Promise.all([
      context.store.getProduct({ id: params.productId }),
      context.store.listCategories(),
    ]);
    return { product, categories };
  },
  component: EditProductPage,
});

function EditProductPage() {
  const { product, categories } = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const form = useProductUpdateForm(product, () => {
    void router.invalidate();
    void navigate({ to: "/products/$productId", params: { productId: product.id } });
  });

  return (
    <PageLayout contentClassName="max-w-3xl">
      <PageHeader>
        <PageHeading>Edit {product.name}</PageHeading>
        <PageDescription>
          Changes apply to the local catalog first and sync in the background.
        </PageDescription>
        <PageAction className="flex items-center gap-2">
          <Link
            className={buttonVariants({ variant: "outline" })}
            params={{ productId: product.id }}
            to="/products/$productId"
          >
            Cancel
          </Link>
          <form.Subscribe selector={(state) => state.canSubmit}>
            {(canSubmit) => (
              <Button disabled={!canSubmit} form="edit-product-form" type="submit">
                Save changes
              </Button>
            )}
          </form.Subscribe>
        </PageAction>
      </PageHeader>

      <PageContent>
        <ProductForm categories={categories} form={form} formId="edit-product-form" />
      </PageContent>
    </PageLayout>
  );
}
