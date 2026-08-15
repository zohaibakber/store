import { View } from "react-native";

import { Spinner } from "@/components/mobile-ui";

export function LoadingScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Spinner color="default" />
    </View>
  );
}
