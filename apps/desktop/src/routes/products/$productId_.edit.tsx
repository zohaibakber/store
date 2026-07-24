import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  PageAction,
  PageContent,
  PageDescription,
  PageHeader,
  PageHeading,
  PageLayout,
} from "@/components/page-layout";
import { ProductForm, useProductUpdateForm } from "@/components/products/product-form";

export const Route = createFileRoute("/products/$productId_/edit")({
  loader: async ({ params }) => {
    const [product, categories] = await Promise.all([
      window.offlineStore.getProduct({ id: params.productId }),
      window.offlineStore.listCategories(),
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
