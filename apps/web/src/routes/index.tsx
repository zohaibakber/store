import { createFileRoute } from "@tanstack/react-router";

import { HomePage } from "@/components/dashboard/home-page";
import { useAuth } from "@/lib/auth";
import { InventoryProvider } from "@/lib/inventory-db";

export const Route = createFileRoute("/")({
  component: DashboardRoute,
});

function DashboardRoute() {
  const auth = useAuth();
  const { access, inventory } = Route.useRouteContext();
  if (!inventory) {
    return <p className="p-6 text-sm text-destructive">Dashboard storage is unavailable.</p>;
  }
  const scope = access.inventoryScope(auth.snapshot);
  if (!scope) {
    return <p className="p-6 text-sm text-destructive">Dashboard workspace is unavailable.</p>;
  }
  return (
    <InventoryProvider
      key={`${scope.organizationId}:${scope.userId}`}
      host={inventory}
      scope={scope}
    >
      <HomePage />
    </InventoryProvider>
  );
}
