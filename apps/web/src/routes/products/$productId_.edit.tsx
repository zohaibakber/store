import { ProductId } from "@store/contracts";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { useProductUpdateForm } from "@/components/products/form";
import { ProductFormPage } from "@/components/products/form-page";

export const Route = createFileRoute("/products/$productId_/edit")({
  loader: async ({ context, params }) => {
    const [product, categories, suggestions] = await Promise.all([
      context.store.getProduct({ id: Schema.decodeUnknownSync(ProductId)(params.productId) }),
      context.store.listCategories(),
      context.store.listProductSuggestions(),
    ]);
    return { product, categories, suggestions };
  },
  component: EditProductPage,
  staticData: {
    breadcrumb: (loaderData) => {
      const productName =
        loaderData && "product" in loaderData ? loaderData.product?.name : undefined;
      return productName ? `Edit ${productName}` : "Edit product";
    },
  },
});

function EditProductPage() {
  const { product, categories, suggestions } = Route.useLoaderData();
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
      form={form}
      formId="edit-product-form"
      submitLabel="Save changes"
      suggestions={suggestions}
      title={`Edit ${product.name}`}
    />
  );
}
