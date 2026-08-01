import { createFileRoute, Link } from "@tanstack/react-router";

import { useProductCreateForm } from "@/components/products/form";
import { ProductFormPage } from "@/components/products/form-page";

export const Route = createFileRoute("/products/new")({
  loader: async ({ context }) => {
    const [categories, compositions] = await Promise.all([
      context.store.listCategories(),
      context.store.listCompositions(),
    ]);
    return { categories, compositions };
  },
  component: NewProductPage,
  staticData: { breadcrumb: "Add product" },
});

function NewProductPage() {
  const { categories, compositions } = Route.useLoaderData();
  const form = useProductCreateForm(categories);

  return (
    <ProductFormPage
      cancelTo={<Link to="/products" />}
      categories={categories}
      compositions={compositions}
      form={form}
      formId="new-product-form"
      submitLabel="Create product"
      title="Add product"
    />
  );
}
