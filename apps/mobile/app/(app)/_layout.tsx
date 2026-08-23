import { Redirect } from "expo-router";

import { AppTabs } from "@/components/app-tabs";
import { LoadingScreen } from "@/components/loading-screen";
import { ProductsProvider } from "@/features/products/products-provider";
import { useMobileAuth } from "@/lib/auth-provider";

export default function AppLayout() {
  const { state } = useMobileAuth();
  if (state._tag === "Loading") return <LoadingScreen />;
  if (state._tag !== "Authenticated") return <Redirect href="/auth" />;
  const organizationId =
    state.workspace.activeOrganization?.id ?? state.workspace.organizations[0]?.id ?? "unassigned";

  return (
    <ProductsProvider organizationId={organizationId} userId={state.inventoryUserId}>
      <AppTabs />
    </ProductsProvider>
  );
}
