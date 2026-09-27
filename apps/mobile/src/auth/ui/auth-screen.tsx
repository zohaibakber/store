import { AlertCircleIcon, WifiDisconnected02Icon } from "@hugeicons/core-free-icons";
import type * as React from "react";
import { KeyboardAvoidingView, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { AuthProblem } from "@/auth/problems";
import { colors, radius, space } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";

export type AuthScreenProps = {
  readonly title: string;
  readonly description?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly footer?: React.ReactNode;
};

export function AuthScreen({ title, description, children, footer }: AuthScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.ground }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          gap: space[8],
          paddingTop: insets.top + space[8],
          paddingBottom: insets.bottom + space[6],
          paddingLeft: insets.left + space[6],
          paddingRight: insets.right + space[6],
        }}
      >
        <View style={{ gap: space[2] }}>
          <Text size="2xl" weight="medium" accessibilityRole="header">
            {title}
          </Text>
          {description === undefined ? null : <Text tone="muted">{description}</Text>}
        </View>
        <View style={{ gap: space[6] }}>{children}</View>
        {footer === undefined ? null : (
          <View style={{ marginTop: "auto", alignItems: "center" }}>{footer}</View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function Attention({ children }: { readonly children: string }) {
  return (
    <View
      style={{
        alignSelf: "flex-start",
        backgroundColor: colors.highlight,
        borderRadius: radius.sm / 2,
        paddingHorizontal: space[1],
      }}
    >
      <Text>{children}</Text>
    </View>
  );
}

export function ProblemMessage({ problem }: { readonly problem: AuthProblem | null }) {
  if (problem === null || problem.field !== undefined) return null;
  const offline = problem.kind === "offline";
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ flexDirection: "row", alignItems: "flex-start", gap: space[2] }}
    >
      <Icon
        icon={offline ? WifiDisconnected02Icon : AlertCircleIcon}
        size={20}
        color={offline ? colors.ink : colors.error}
      />
      <Text tone={offline ? "ink" : "error"} style={{ flex: 1 }}>
        {problem.message}
      </Text>
    </View>
  );
}

export const fieldError = (
  problem: AuthProblem | null,
  field: NonNullable<AuthProblem["field"]>,
) => (problem?.field === field ? problem.message : null);
