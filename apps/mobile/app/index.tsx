import { Redirect } from "expo-router";

import { LoadingScreen } from "@/components/loading-screen";
import { useMobileAuth } from "@/lib/auth-provider";

export default function IndexScreen() {
  const { state } = useMobileAuth();
  if (state._tag === "Loading") return <LoadingScreen />;
  if (state._tag !== "Authenticated") return <Redirect href="/auth" />;
  return <Redirect href="/home" />;
}
