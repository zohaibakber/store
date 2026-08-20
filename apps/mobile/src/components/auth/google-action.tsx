import { GoogleMark } from "@/components/auth/google-mark";
import { Button, ButtonText } from "@/components/ui/button";

/**
 * Opens Google's account picker. An `outline` button, quieter than the email
 * action on purpose — the mark is the only colour on the screen, and it is
 * Google's, not ours.
 *
 * Presentation only: the press still hands straight to the native sign-in SDK.
 */
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
