import { Redirect } from "expo-router";
import { View } from "react-native";

import { useSession } from "@/auth";
import { colors } from "@/theme/tokens";

export default function NotFound() {
  const session = useSession();
  switch (session.status) {
    case "loading":
      return <View style={{ flex: 1, backgroundColor: colors.ground }} />;
    case "signedOut":
      return <Redirect href="/sign-in" />;
    case "needsOrganization":
      return <Redirect href="/organization" />;
    case "signedIn":
      return <Redirect href="/" />;
  }
}
