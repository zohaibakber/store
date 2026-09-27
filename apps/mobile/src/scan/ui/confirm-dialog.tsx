import { Host } from "@expo/ui";
import { AlertDialog, Text } from "@expo/ui/jetpack-compose";
import { StyleSheet } from "react-native";

import { ComposeActionButton } from "@/features/action-button";
import { colors, fonts, type } from "@/theme/tokens";

const dialogColors = {
  containerColor: colors.ground,
  titleContentColor: colors.ink,
  textContentColor: colors.muted,
};
const titleStyle = {
  fontFamily: fonts.medium,
  fontSize: type.lg.fontSize,
  lineHeight: type.lg.lineHeight,
};
const bodyStyle = {
  fontFamily: fonts.regular,
  fontSize: type.sm.fontSize,
  lineHeight: type.sm.lineHeight,
};

export type ConfirmRequest = {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly onConfirm: () => void;
};

export function ConfirmDialog({
  request,
  onClose,
}: {
  readonly request: ConfirmRequest | null;
  readonly onClose: () => void;
}) {
  if (request === null) return null;
  const confirm = () => {
    onClose();
    request.onConfirm();
  };
  return (
    <Host matchContents style={styles.host}>
      <AlertDialog colors={dialogColors} onDismissRequest={onClose}>
        <AlertDialog.Title>
          <Text style={titleStyle}>{request.title}</Text>
        </AlertDialog.Title>
        <AlertDialog.Text>
          <Text style={bodyStyle}>{request.body}</Text>
        </AlertDialog.Text>
        <AlertDialog.ConfirmButton>
          <ComposeActionButton label={request.confirmLabel} onPress={confirm} />
        </AlertDialog.ConfirmButton>
        <AlertDialog.DismissButton>
          <ComposeActionButton label={request.cancelLabel} onPress={onClose} variant="text" />
        </AlertDialog.DismissButton>
      </AlertDialog>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute" },
});
