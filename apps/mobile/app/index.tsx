import { useAuth } from "@clerk/expo";
import { Redirect } from "expo-router";

import { LoadingScreen } from "@/components/loading-screen";
import { useLastUserId } from "@/lib/local-session";

export default function IndexScreen() {
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const lastUserId = useLastUserId();
  if (isSignedIn || (!isLoaded && lastUserId)) return <Redirect href="/home" />;
  if (!isLoaded || lastUserId === undefined) return <LoadingScreen />;
  return <Redirect href="/auth" />;
}
