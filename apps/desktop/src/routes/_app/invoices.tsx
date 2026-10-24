import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/invoices")({
  component: InvoicesLayout,
  staticData: { breadcrumb: "Invoices" },
});

function InvoicesLayout() {
  return <Outlet />;
}
