import { StyleSheet, Text, View } from "react-native";

import { Footnote, StepHeader } from "@/components/auth/auth-shell";
import { OtpField } from "@/components/auth/otp-field";
import { QuietAction, QuietActions } from "@/components/auth/quiet-action";
import { Button } from "@/components/ui/button";
import { useThemeColor } from "@/hooks/use-theme-color";

export function OtpStep({
  busy,
  code,
  developmentCode,
  email,
  onCodeChange,
  onResend,
  onStartOver,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly code: string;
  readonly developmentCode?: string;
  readonly email: string;
  readonly onCodeChange: (value: string) => void;
  readonly onResend: () => void;
  readonly onStartOver: () => void;
  readonly onSubmit: () => void;
}) {
  const foreground = useThemeColor("foreground");

  return (
    <View style={styles.step}>
      <StepHeader caption={email} title="Enter your code" />
      <View style={styles.form}>
        <OtpField code={code} editable={!busy} onChange={onCodeChange} />
        {developmentCode ? (
          <Text selectable style={[styles.code, { color: foreground }]}>
            {developmentCode}
          </Text>
        ) : null}
        <Footnote>
          {developmentCode
            ? "Email delivery is not live yet, so the code is printed above instead of sent."
            : "Email delivery is not live yet, so this code never reached your inbox."}
        </Footnote>
        <Button isDisabled={busy || code.length < 6} onPress={onSubmit}>
          {busy ? "Verifying…" : "Verify code"}
        </Button>
        <QuietActions>
          <QuietAction isDisabled={busy} label="New code" onPress={onResend} />
          <QuietAction isDisabled={busy} label="Different email" onPress={onStartOver} />
        </QuietActions>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  code: { fontFamily: "GeistMono_500Medium", fontSize: 18, letterSpacing: 4, lineHeight: 24 },
  form: { gap: 12 },
  step: { gap: 24 },
});
