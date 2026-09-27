import { useRouter } from "expo-router";
import type * as React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSession } from "@/auth";
import { colors, radius, space, touch } from "@/theme/tokens";
import { Text } from "@/ui/text";

import { initialsOf } from "./format";

export function TabHeader({
  title,
  trailing,
}: {
  readonly title: string;
  readonly trailing?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + space[2] }]}>
      <Text accessibilityRole="header" size="2xl" weight="medium" style={styles.title}>
        {title}
      </Text>
      {trailing}
    </View>
  );
}

export function AccountAvatar() {
  const session = useSession();
  const { push } = useRouter();
  const name =
    session.status === "signedIn"
      ? session.displayName || session.email
      : session.status === "needsOrganization"
        ? session.email
        : "";
  const openSettings = () => push("/settings");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Account and settings"
      hitSlop={space[1]}
      onPress={openSettings}
      style={styles.avatarTarget}
    >
      <View style={styles.avatar}>
        <Text size="xs" weight="medium">
          {initialsOf(name) || "?"}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: space[4],
    paddingRight: space[2],
    paddingBottom: space[2],
    minHeight: touch.primary,
    backgroundColor: colors.ground,
  },
  title: {
    flexShrink: 1,
  },
  avatarTarget: {
    width: touch.minimum,
    height: touch.minimum,
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
});
