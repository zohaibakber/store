import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/purchases")({
  component: PurchasesLayout,
  staticData: { breadcrumb: "Purchases" },
});

function PurchasesLayout() {
  return <Outlet />;
}
