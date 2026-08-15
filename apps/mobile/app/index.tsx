import { useAuth } from "@clerk/expo";
import { Redirect } from "expo-router";

import { LoadingScreen } from "@/components/loading-screen";

export default function IndexScreen() {
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  if (!isLoaded) return <LoadingScreen />;
  return <Redirect href={isSignedIn ? "/home" : "/auth"} />;
}
