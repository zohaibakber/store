import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/invoices")({
  component: InvoicesLayout,
  staticData: { breadcrumb: "Invoices" },
});

function InvoicesLayout() {
  return <Outlet />;
}
