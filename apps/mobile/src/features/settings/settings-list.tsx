import { FieldGroup, Host } from "@expo/ui";
import { AlertDialog, Column, Row, Text } from "@expo/ui/jetpack-compose";
import { clickable, fillMaxWidth, padding } from "@expo/ui/jetpack-compose/modifiers";
import * as Application from "expo-application";
import * as React from "react";
import { StyleSheet } from "react-native";

import { colors, fonts, space, type } from "@/theme/tokens";

import { ComposeActionButton } from "../action-button";
import { appVersionLabel } from "../format";

const groupStyle = { backgroundColor: colors.ground };
const labelStyle = {
  fontFamily: fonts.regular,
  fontSize: type.xs.fontSize,
  lineHeight: type.xs.lineHeight,
};
const valueStyle = {
  fontFamily: fonts.regular,
  fontSize: type.base.fontSize,
  lineHeight: type.base.lineHeight,
};
const actionStyle = {
  fontFamily: fonts.medium,
  fontSize: type.base.fontSize,
  lineHeight: type.base.lineHeight,
};
const dialogText = {
  fontFamily: fonts.regular,
  fontSize: type.sm.fontSize,
  lineHeight: type.sm.lineHeight,
};
const dialogTitle = {
  fontFamily: fonts.medium,
  fontSize: type.lg.fontSize,
  lineHeight: type.lg.lineHeight,
};
const dialogColors = {
  containerColor: colors.ground,
  titleContentColor: colors.ink,
  textContentColor: colors.muted,
};

export type SettingsAccount = {
  readonly email: string;
  readonly organizationName: string | null;
};

export function SettingsList({
  account,
  onSignOut,
}: {
  readonly account: SettingsAccount;
  readonly onSignOut: () => Promise<void>;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);
  const signOut = () => {
    setSigningOut(true);
    void onSignOut().finally(() => {
      setSigningOut(false);
      setConfirming(false);
    });
  };
  const signOutModifiers = [
    fillMaxWidth(),
    clickable(() => setConfirming(true)),
    padding(0, space[3], 0, space[3]),
  ];
  return (
    <Host colorScheme="light" seedColor={colors.ink} style={styles.host}>
      <FieldGroup style={groupStyle}>
        <FieldGroup.Section title="Account">
          <InfoRow label="Signed in as" value={account.email} />
          {account.organizationName === null ? null : (
            <InfoRow label="Organization" value={account.organizationName} />
          )}
        </FieldGroup.Section>
        <FieldGroup.Section>
          <Row modifiers={signOutModifiers}>
            <Text color={colors.error} style={actionStyle}>
              Sign out
            </Text>
          </Row>
        </FieldGroup.Section>
        <FieldGroup.Section title="About">
          <InfoRow
            label="Version"
            value={appVersionLabel(
              Application.nativeApplicationVersion,
              Application.nativeBuildVersion,
            )}
          />
        </FieldGroup.Section>
      </FieldGroup>
      {confirming ? (
        <AlertDialog colors={dialogColors} onDismissRequest={() => setConfirming(false)}>
          <AlertDialog.Title>
            <Text style={dialogTitle}>Sign out?</Text>
          </AlertDialog.Title>
          <AlertDialog.Text>
            <Text style={dialogText}>
              You will need to sign in again to use Store on this phone.
            </Text>
          </AlertDialog.Text>
          <AlertDialog.ConfirmButton>
            <ComposeActionButton disabled={signingOut} label="Sign out" onPress={signOut} />
          </AlertDialog.ConfirmButton>
          <AlertDialog.DismissButton>
            <ComposeActionButton
              label="Cancel"
              onPress={() => setConfirming(false)}
              variant="text"
            />
          </AlertDialog.DismissButton>
        </AlertDialog>
      ) : null}
    </Host>
  );
}

function InfoRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <Column verticalArrangement={{ spacedBy: 2 }}>
      <Text color={colors.muted} style={labelStyle}>
        {label}
      </Text>
      <Text color={colors.ink} style={valueStyle}>
        {value}
      </Text>
    </Column>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
});
