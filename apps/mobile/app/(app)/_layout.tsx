import { Redirect } from "expo-router";
import { View } from "react-native";

import { AppTabs } from "@/components/app-tabs";
import { LoadingScreen } from "@/components/loading-screen";
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ProductsProvider } from "@/features/products/products-provider";
import { useMobileAuth } from "@/lib/auth-provider";
import { useColors } from "@/theme/colors";

function MissingOrganizationScreen() {
  const colors = useColors();
  return (
    <View style={{ backgroundColor: colors.background, flex: 1, justifyContent: "center" }}>
      <Empty>
        <EmptyMedia name="box" />
        <EmptyTitle>No organization yet</EmptyTitle>
        <EmptyDescription>
          Join or create an organization on desktop or the web before opening inventory here.
        </EmptyDescription>
      </Empty>
    </View>
  );
}

export default function AppLayout() {
  const { state } = useMobileAuth();
  if (state._tag === "Loading") return <LoadingScreen />;
  if (state._tag !== "Authenticated") return <Redirect href="/auth" />;
  const organizationId =
    state.workspace.activeOrganization?.id ?? state.workspace.organizations[0]?.id;
  if (!organizationId) return <MissingOrganizationScreen />;

  return (
    <ProductsProvider organizationId={organizationId} userId={state.inventoryUserId}>
      <AppTabs />
    </ProductsProvider>
  );
}
