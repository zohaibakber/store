import { createFileRoute, Outlet } from "@tanstack/react-router";

import { PageContent, PageHeader, PageHeading, PageLayout } from "@/components/shared/page-layout";
import { useAuth } from "@/lib/auth";
import { InventoryProvider } from "@/lib/inventory-db";

export const Route = createFileRoute("/invoices")({
  component: InvoicesLayout,
  staticData: { breadcrumb: "Invoices" },
});

function InvoicesLayout() {
  const auth = useAuth();
  const { access, inventory } = Route.useRouteContext();
  const scope = access.inventoryScope(auth.snapshot);
  if (!inventory || !scope) {
    const message = inventory
      ? "Select an organization to manage invoices."
      : "Invoice storage is unavailable in this build.";
    return (
      <PageLayout>
        <PageHeader>
          <PageHeading>Invoices unavailable</PageHeading>
        </PageHeader>
        <PageContent>
          <p className="text-sm text-muted-foreground">{message}</p>
        </PageContent>
      </PageLayout>
    );
  }
  return (
    <InventoryProvider
      key={`${scope._tag}:${scope.organizationId}:${scope.userId}`}
      host={inventory}
      scope={scope}
    >
      <Outlet />
    </InventoryProvider>
  );
}
