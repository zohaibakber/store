import { useAuth, useUser } from "@clerk/expo";
import { Redirect } from "expo-router";

import { FloatingTabs } from "@/components/floating-tabs";
import { LoadingScreen } from "@/components/loading-screen";
import { ProductsProvider } from "@/features/products/products-provider";

export default function AppLayout() {
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const { user } = useUser();

  if (!isLoaded) return <LoadingScreen />;
  if (!isSignedIn || !user) return <Redirect href="/auth" />;

  return (
    <ProductsProvider userId={user.id}>
      <FloatingTabs />
    </ProductsProvider>
  );
}
