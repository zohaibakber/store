import { ProductId } from "@store/contracts/ids";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { useProductUpdateForm } from "@/components/products/form";
import { ProductFormPage } from "@/components/products/form-page";
import {
  useCatalogSuggestions,
  useSuspenseCatalogCategories,
  useSuspenseCatalogProduct,
} from "@/lib/inventory";

export const Route = createFileRoute("/products/$productId_/edit")({
  component: EditProductPage,
  staticData: { breadcrumb: "Edit product" },
});

function EditProductPage() {
  const { productId } = Route.useParams();
  const id = Schema.decodeUnknownSync(ProductId)(productId);
  const categories = useSuspenseCatalogCategories();
  const product = useSuspenseCatalogProduct(id);
  const suggestions = useCatalogSuggestions();
  if (!product) throw new Error(`Product ${productId} was not found in this catalog.`);
  return <EditProductForm categories={categories} product={product} suggestions={suggestions} />;
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
