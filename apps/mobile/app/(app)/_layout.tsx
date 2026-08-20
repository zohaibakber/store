import { Redirect } from "expo-router";

import { FloatingTabs } from "@/components/floating-tabs";
import { LoadingScreen } from "@/components/loading-screen";
import { ProductsProvider } from "@/features/products/products-provider";
import { useMobileAuth } from "@/lib/auth-provider";

export default function AppLayout() {
  const { state } = useMobileAuth();
  if (state._tag === "Loading") return <LoadingScreen />;
  if (state._tag !== "Authenticated") return <Redirect href="/auth" />;

  return (
    <ProductsProvider userId={state.inventoryUserId}>
      <FloatingTabs />
    </ProductsProvider>
  );
}
