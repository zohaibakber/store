import { createFileRoute, Link } from "@tanstack/react-router";

import { useProductCreateForm } from "@/components/products/form";
import { ProductFormPage } from "@/components/products/form-page";
import { useCatalogCategories, useCatalogSuggestions, useInventoryState } from "@/lib/inventory-db";

export const Route = createFileRoute("/products/new")({
  component: NewProductPage,
  staticData: { breadcrumb: "Add product" },
});

function NewProductPage() {
  const state = useInventoryState();
  if (!state || state._tag !== "Ready") throw new Error("The catalog is not ready.");
  return <LiveNewProductPage inventory={state.inventory} />;
}

function LiveNewProductPage({
  inventory,
}: {
  readonly inventory: Extract<
    NonNullable<ReturnType<typeof useInventoryState>>,
    { _tag: "Ready" }
  >["inventory"];
}) {
  const categories = useCatalogCategories(inventory);
  const suggestions = useCatalogSuggestions(inventory);
  if (categories.isError && categories.data.length === 0) {
    throw new Error("The catalog categories could not be loaded.");
  }
  return <NewProductForm categories={categories.data} suggestions={suggestions} />;
}

function NewProductForm({
  categories,
  suggestions,
}: {
  readonly categories: Parameters<typeof useProductCreateForm>[0];
  readonly suggestions: React.ComponentProps<typeof ProductFormPage>["suggestions"];
}) {
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
