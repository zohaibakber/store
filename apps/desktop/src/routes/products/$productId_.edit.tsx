import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";

import { ProductForm, useProductUpdateForm } from "@/components/products/form";
import { FrameCard } from "@/components/shared/frame-card";
import { PageContent, PageLayout } from "@/components/shared/page-layout";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/products/$productId_/edit")({
  loader: async ({ context, params }) => {
    const [product, categories] = await Promise.all([
      context.store.getProduct({ id: params.productId }),
      context.store.listCategories(),
    ]);
    return { product, categories };
  },
  component: EditProductPage,
  staticData: {
    breadcrumb: (loaderData) => {
      const productName = (loaderData as { product?: { name: string } } | undefined)?.product?.name;
      return productName ? `Edit ${productName}` : "Edit product";
    },
  },
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
      <PageContent>
        <FrameCard
          action={
            <div className="flex items-center gap-2">
              <Button
                render={<Link params={{ productId: product.id }} to="/products/$productId" />}
                size="sm"
                variant="outline"
              >
                Cancel
              </Button>
              <form.Subscribe selector={(state) => state.canSubmit}>
                {(canSubmit) => (
                  <Button disabled={!canSubmit} form="edit-product-form" size="sm" type="submit">
                    Save changes
                  </Button>
                )}
              </form.Subscribe>
            </div>
          }
          title={<h1 className="font-medium">Edit {product.name}</h1>}
        >
          <ProductForm categories={categories} form={form} formId="edit-product-form" />
        </FrameCard>
      </PageContent>
    </PageLayout>
  );
}
