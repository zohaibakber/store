import { FloatingTabs } from "@/components/floating-tabs";
import { LoadingScreen } from "@/components/loading-screen";
import { ProductsProvider } from "@/features/products/products-provider";
import { useMobileAuth } from "@/lib/auth-provider";

export default function AppLayout() {
  const { state } = useMobileAuth();
  if (state._tag === "Loading") return <LoadingScreen />;

  return (
    <ProductsProvider userId={state.inventoryUserId}>
      <FloatingTabs />
    </ProductsProvider>
  );
}
