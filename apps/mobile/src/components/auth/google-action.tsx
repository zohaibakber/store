import { GoogleMark } from "@/components/auth/google-mark";
import { Button, ButtonText } from "@/components/ui/button";

export function GoogleAction({
  isDisabled,
  onPress,
}: {
  readonly isDisabled?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Button
      accessibilityLabel="Continue with Google"
      isDisabled={isDisabled}
      onPress={onPress}
      variant="outline"
    >
      <GoogleMark />
      <ButtonText>Continue with Google</ButtonText>
    </Button>
  );
}
