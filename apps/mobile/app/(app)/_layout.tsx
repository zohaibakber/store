import { useAuth } from "@clerk/expo";
import { Redirect } from "expo-router";

import { FloatingTabs } from "@/components/floating-tabs";
import { LoadingScreen } from "@/components/loading-screen";
import { ProductsProvider } from "@/features/products/products-provider";
import { useLastUserId } from "@/lib/local-session";

export default function AppLayout() {
  const { isLoaded, isSignedIn, userId } = useAuth({ treatPendingAsSignedOut: false });
  const lastUserId = useLastUserId();
  const resolvedUserId = userId ?? lastUserId ?? null;

  if (isLoaded && !isSignedIn) return <Redirect href="/auth" />;
  if (!resolvedUserId) return isLoaded ? <Redirect href="/auth" /> : <LoadingScreen />;

  return (
    <ProductsProvider userId={resolvedUserId}>
      <FloatingTabs />
    </ProductsProvider>
  );
}
