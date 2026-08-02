import { createFileRoute, Link } from "@tanstack/react-router";

import { useProductCreateForm } from "@/components/products/form";
import { ProductFormPage } from "@/components/products/form-page";

export const Route = createFileRoute("/products/new")({
  loader: async ({ context }) => {
    const [categories, suggestions] = await Promise.all([
      context.store.listCategories(),
      context.store.listProductSuggestions(),
    ]);
    return { categories, suggestions };
  },
  component: NewProductPage,
  staticData: { breadcrumb: "Add product" },
});

function NewProductPage() {
  const { categories, suggestions } = Route.useLoaderData();
  const form = useProductCreateForm(categories);

  return (
    <ProductFormPage
      cancelTo={<Link to="/products" />}
      categories={categories}
      form={form}
      formId="new-product-form"
      submitLabel="Create product"
      suggestions={suggestions}
      title="Add product"
    />
  );
}
