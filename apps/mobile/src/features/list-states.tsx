import type * as React from "react";
import { StyleSheet, View } from "react-native";

import { colors, radius, space } from "@/theme/tokens";
import { Text } from "@/ui/text";

const SKELETON_ROWS = [0, 1, 2, 3, 4, 5, 6];

export function ListSkeleton({ label }: { readonly label: string }) {
  return (
    <View accessibilityLabel={label} accessible style={styles.skeleton}>
      {SKELETON_ROWS.map((row) => (
        <View key={row} style={styles.skeletonRow}>
          <View style={styles.skeletonBody}>
            <View style={styles.skeletonTitle} />
            <View style={styles.skeletonSubtitle} />
          </View>
          <View style={styles.skeletonCount} />
        </View>
      ))}
    </View>
  );
}

export function RowSeparator() {
  return <View style={styles.separator} />;
}

export function EmptyState({
  title,
  body,
  action,
}: {
  readonly title: string;
  readonly body: string;
  readonly action?: React.ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <Text size="lg" weight="medium" style={styles.center}>
        {title}
      </Text>
      <Text tone="muted" style={styles.center}>
        {body}
      </Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    paddingTop: space[2],
  },
  skeletonRow: {
    height: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    paddingHorizontal: space[4],
  },
  skeletonBody: {
    flex: 1,
    gap: space[2],
  },
  skeletonTitle: {
    height: 14,
    width: "60%",
    borderRadius: radius.sm / 2,
    backgroundColor: colors.surface,
  },
  skeletonSubtitle: {
    height: 10,
    width: "40%",
    borderRadius: radius.sm / 2,
    backgroundColor: colors.surface,
  },
  skeletonCount: {
    height: 14,
    width: 32,
    borderRadius: radius.sm / 2,
    backgroundColor: colors.surface,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: space[4],
    backgroundColor: colors.hairline,
  },
  empty: {
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[8],
    paddingTop: space[8] * 2,
  },
  center: {
    textAlign: "center",
  },
});
