import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";

import { useProductUpdateForm } from "@/components/products/form";
import { ProductFormPage } from "@/components/products/form-page";

export const Route = createFileRoute("/products/$productId_/edit")({
  loader: async ({ context, params }) => {
    const [product, categories, compositions] = await Promise.all([
      context.store.getProduct({ id: params.productId }),
      context.store.listCategories(),
      context.store.listCompositions(),
    ]);
    return { product, categories, compositions };
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
  const { product, categories, compositions } = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const form = useProductUpdateForm(product, categories, () => {
    void router.invalidate();
    void navigate({ to: "/products/$productId", params: { productId: product.id } });
  });

  return (
    <ProductFormPage
      cancelTo={<Link params={{ productId: product.id }} to="/products/$productId" />}
      categories={categories}
      compositions={compositions}
      form={form}
      formId="edit-product-form"
      submitLabel="Save changes"
      title={`Edit ${product.name}`}
    />
  );
}
