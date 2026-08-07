import { Spinner } from "heroui-native/spinner";
import { View } from "react-native";

export function LoadingScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Spinner color="default" />
    </View>
  );
}
