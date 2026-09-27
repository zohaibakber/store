import {
  Alert02Icon,
  Delete02Icon,
  ImageNotFound01Icon,
  Loading03Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { Image } from "expo-image";
import * as React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, radius, space, touch } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";

import type { DraftStatus } from "../status";

export type DraftRowItem = {
  readonly id: string;
  readonly photoUri: string | null;
  readonly title: string;
  readonly subtitle: string;
  readonly trailing: string | null;
  readonly status: DraftStatus;
};

const STATUS_ICON = { ready: Tick02Icon, check: Alert02Icon, reading: Loading03Icon } as const;
const STATUS_LABEL = { ready: "Ready", check: "Needs a check", reading: "Still reading" } as const;

export const DraftRow = React.memo(function DraftRow({
  id,
  photoUri,
  title,
  subtitle,
  trailing,
  status,
  onOpen,
  onDelete,
}: DraftRowItem & {
  readonly onOpen: (id: string) => void;
  readonly onDelete?: ((id: string) => void) | undefined;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${STATUS_LABEL[status]}. ${subtitle}`}
        onPress={() => onOpen(id)}
        android_ripple={{ color: colors.hairline }}
        style={styles.main}
      >
        <View style={styles.thumb}>
          {photoUri === null ? (
            <Icon icon={ImageNotFound01Icon} size={18} color={colors.muted} />
          ) : (
            <Image
              source={{ uri: photoUri }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              recyclingKey={photoUri}
            />
          )}
        </View>
        <View style={styles.text}>
          <View style={styles.titleRow}>
            <Text size="base" weight="medium" numberOfLines={1} style={styles.title}>
              {title}
            </Text>
            <View style={[styles.badge, status === "check" && styles.badgeCheck]}>
              <Icon icon={STATUS_ICON[status]} size={12} strokeWidth={2} />
            </View>
          </View>
          <Text size="xs" tone="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        </View>
        {trailing === null ? null : (
          <Text size="base" weight="medium" tabular>
            {trailing}
          </Text>
        )}
      </Pressable>
      {onDelete === undefined ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete ${title}`}
          onPress={() => onDelete(id)}
          style={styles.delete}
        >
          <Icon icon={Delete02Icon} size={20} color={colors.muted} />
        </Pressable>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  main: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    minHeight: 72,
    paddingVertical: space[2],
    paddingLeft: space[4],
    paddingRight: space[2],
  },
  thumb: {
    width: 48,
    height: 56,
    borderRadius: radius.sm,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  text: { flex: 1, gap: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  title: { flexShrink: 1 },
  badge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  badgeCheck: { backgroundColor: colors.highlight },
  delete: {
    width: touch.minimum,
    height: touch.minimum,
    alignItems: "center",
    justifyContent: "center",
    marginRight: space[2],
  },
});
