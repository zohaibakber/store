import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/products")({
  component: ProductsLayout,
  staticData: { breadcrumb: "Products" },
});

function ProductsLayout() {
  return <Outlet />;
}
