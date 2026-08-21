import { createFileRoute } from "@tanstack/react-router";

import { CategorySettings } from "@/components/settings/category-settings";

export const Route = createFileRoute("/settings/categories")({
  loader: ({ context }) => context.store.listCategories(),
  component: CategoriesRoute,
  staticData: { breadcrumb: "Categories" },
});

function CategoriesRoute() {
  return <CategorySettings categories={Route.useLoaderData()} />;
}
