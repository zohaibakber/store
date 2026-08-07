import { Redirect } from "expo-router";

import { LoadingScreen } from "@/components/loading-screen";
import { authClient } from "@/lib/auth-client";

export default function IndexScreen() {
  const session = authClient.useSession();
  if (session.isPending) return <LoadingScreen />;
  return <Redirect href={session.data?.user ? "/home" : "/auth"} />;
}
