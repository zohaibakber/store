import { useAuth } from "@clerk/expo";
import { Redirect } from "expo-router";

import { LoadingScreen } from "@/components/loading-screen";

export default function AuthScreen() {
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });

  if (!isLoaded) return <LoadingScreen />;
  if (isSignedIn) return <Redirect href="/home" />;

  return <LoadingScreen />;
}
