import { BottomSheet, Button, Column, Text } from "@expo/ui";

import { useThemeColor } from "@/hooks/use-theme-color";
import { cssColor } from "@/theme/colors";

/**
 * A native sheet, not a route: UISheetPresentationController on iOS,
 * ModalBottomSheet on Android. Content is sized so the iOS detent fits it.
 * "Not now" is the dismiss affordance Android has instead of a grabber.
 */
export function GoogleSheet({
  busy,
  isPresented,
  onContinue,
  onDismiss,
}: {
  readonly busy: boolean;
  readonly isPresented: boolean;
  readonly onContinue: () => void;
  readonly onDismiss: () => void;
}) {
  const [foreground, muted] = useThemeColor(["foreground", "muted"]);

  return (
    <BottomSheet isPresented={isPresented} onDismiss={onDismiss}>
      <Column spacing={12} style={{ paddingBottom: 24 }}>
        <Text textStyle={{ color: cssColor(foreground), fontSize: 18, fontWeight: "500" }}>
          Continue with Google
        </Text>
        <Text textStyle={{ color: cssColor(muted), fontSize: 14 }}>
          Google opens in the system sign-in sheet. Tabaaq receives your name and email.
        </Text>
        <Button
          disabled={busy}
          label={busy ? "Waiting for Google…" : "Continue"}
          onPress={onContinue}
          variant="filled"
        />
        <Button disabled={busy} label="Not now" onPress={onDismiss} variant="text" />
      </Column>
    </BottomSheet>
  );
}
