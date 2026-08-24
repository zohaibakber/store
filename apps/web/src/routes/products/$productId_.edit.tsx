import { ProductId } from "@store/contracts/ids";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { useProductUpdateForm } from "@/components/products/form";
import { ProductFormPage } from "@/components/products/form-page";
import {
  useCatalogCategories,
  useCatalogProducts,
  useCatalogSuggestions,
  useInventoryState,
} from "@/lib/inventory-db";

export const Route = createFileRoute("/products/$productId_/edit")({
  component: EditProductPage,
  staticData: { breadcrumb: "Edit product" },
});

function EditProductPage() {
  const { productId } = Route.useParams();
  const state = useInventoryState();
  if (!state || state._tag !== "Ready") throw new Error("The catalog is not ready.");
  return <LiveEditProductPage inventory={state.inventory} productId={productId} />;
}

function LiveEditProductPage({
  inventory,
  productId,
}: {
  readonly inventory: Extract<
    NonNullable<ReturnType<typeof useInventoryState>>,
    { _tag: "Ready" }
  >["inventory"];
  readonly productId: string;
}) {
  const categories = useCatalogCategories(inventory);
  const products = useCatalogProducts(inventory);
  const suggestions = useCatalogSuggestions(inventory);
  const id = Schema.decodeUnknownSync(ProductId)(productId);
  const product = products.data.find((candidate) => candidate.id === id);
  if (product && categories.data.length > 0) {
    return (
      <EditProductForm categories={categories.data} product={product} suggestions={suggestions} />
    );
  }
  if (
    (categories.isError && categories.data.length === 0) ||
    (products.isError && !product)
  ) {
    throw new Error("The product form data could not be loaded.");
  }
  if (!product) {
    if (!categories.isReady || !products.isReady) return null;
    throw new Error(`Product ${productId} was not found in this catalog.`);
  }
  return (
    <EditProductForm categories={categories.data} product={product} suggestions={suggestions} />
  );
}

function EditProductForm({
  categories,
  product,
  suggestions,
}: {
  readonly categories: Parameters<typeof useProductUpdateForm>[1];
  readonly product: Parameters<typeof useProductUpdateForm>[0];
  readonly suggestions: React.ComponentProps<typeof ProductFormPage>["suggestions"];
}) {
  const navigate = useNavigate();
  const form = useProductUpdateForm(product, categories, () => {
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
