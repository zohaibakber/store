import { Children, Fragment, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { Icon } from "@/components/ui/icon";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { useColors } from "@/theme/colors";
import { radius, size as sizes } from "@/theme/tokens";

/**
 * A grouped list, the way `apps/web` builds a settings group: one bordered
 * surface, hairline separators between rows, no per-row card. Rows are `Row`
 * children; the group inserts the separators so rows never restate them.
 */
export function RowGroup({ children }: { readonly children: ReactNode }) {
  const colors = useColors();
  const rows = Children.toArray(children).filter(Boolean);

  return (
    <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {rows.map((row, index) => (
        // The index is the key because a separator has no identity of its own;
        // the row inside carries whatever key its caller gave it.
        <Fragment key={index}>
          {index > 0 ? <Separator /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

export function Row({
  accessibilityHint,
  isDisabled,
  leading,
  onPress,
  supporting,
  title,
  tone = "default",
  trailing,
}: {
  /** What the tap does, when the title alone doesn't say. */
  readonly accessibilityHint?: string;
  readonly isDisabled?: boolean;
  readonly leading?: ReactNode;
  readonly onPress?: () => void;
  readonly supporting?: string;
  readonly title: string;
  readonly tone?: "default" | "destructive";
  readonly trailing?: ReactNode;
}) {
  const body = (
    <View style={[styles.row, supporting ? styles.rowTwoLine : styles.rowOneLine]}>
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.content}>
        <Text numberOfLines={1} tone={tone === "destructive" ? "destructive" : "default"}>
          {title}
        </Text>
        {supporting ? (
          <Text numberOfLines={2} tone="muted" variant="caption">
            {supporting}
          </Text>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );

  if (!onPress) return body;

  return (
    <PressableScale
      accessibilityHint={accessibilityHint}
      accessibilityLabel={title}
      isDisabled={isDisabled}
      onPress={onPress}
    >
      {body}
    </PressableScale>
  );
}

/**
 * The "this pushes a route" affordance. It is explicit rather than inferred from
 * `onPress`, because plenty of rows are tappable without navigating anywhere —
 * a row that reveals a hidden value should not promise a screen.
 */
export function RowChevron() {
  return <Icon name="chevron" size={16} tone="muted" />;
}

/** Right-aligned value for a row: muted, tabular, never wrapping. */
export function RowValue({
  children,
  label,
  tone = "muted",
}: {
  readonly children: string;
  /** Spoken instead of the glyphs, for values rendered as a mask. */
  readonly label?: string;
  readonly tone?: "muted" | "default" | "destructive" | "warning" | "success";
}) {
  return (
    <Text accessibilityLabel={label} numberOfLines={1} tone={tone} variant="mono">
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, gap: 2, minWidth: 0 },
  group: {
    borderCurve: "continuous",
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  leading: { alignItems: "center", justifyContent: "center", width: 24 },
  row: { alignItems: "center", flexDirection: "row", gap: 12, paddingHorizontal: 16 },
  rowOneLine: { minHeight: sizes.listRow },
  rowTwoLine: { minHeight: sizes.listRowTwoLine, paddingVertical: 10 },
  trailing: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
    maxWidth: "45%",
  },
});
