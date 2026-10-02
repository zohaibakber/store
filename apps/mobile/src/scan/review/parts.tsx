import { Host } from "@expo/ui";
import {
  FilterChip,
  FlowRow,
  SegmentedButton,
  SingleChoiceSegmentedButtonRow,
  SuggestionChip,
  Text as ComposeText,
} from "@expo/ui/jetpack-compose";
import { fillMaxWidth } from "@expo/ui/jetpack-compose/modifiers";
import {
  AlertCircleIcon,
  ImageNotFound01Icon,
  PackageIcon,
  Tick02Icon,
  WifiOff01Icon,
} from "@hugeicons/core-free-icons";
import { Image } from "expo-image";
import * as React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, fonts, radius, space, touch, type } from "@/theme/tokens";
import { ActionButton } from "@/ui/action-button";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";

import type { CategoryChoice, ScanMatch } from "../catalog";
import type { CommitChoice } from "../fields";
import { PressScale } from "../ui/press-scale";

export function SourceStrip({
  photoUri,
  text,
  initiallyExpanded,
}: {
  readonly photoUri: string | null;
  readonly text: string;
  readonly initiallyExpanded: boolean;
}) {
  const [expanded, setExpanded] = React.useState(initiallyExpanded);
  const recognized = text.trim() || "No text was recognised on this label.";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={expanded ? "Collapse recognised text" : "Expand recognised text"}
      onPress={() => setExpanded((current) => !current)}
      style={styles.source}
    >
      <View style={styles.sourcePhoto}>
        {photoUri === null ? (
          <Icon icon={ImageNotFound01Icon} size={20} color={colors.muted} />
        ) : (
          <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        )}
      </View>
      <Text
        size="xs"
        mono
        selectable
        numberOfLines={expanded ? undefined : 3}
        style={styles.sourceText}
      >
        {recognized}
      </Text>
    </Pressable>
  );
}

const CHOICES: ReadonlyArray<{ readonly choice: CommitChoice; readonly label: string }> = [
  { choice: "addBatch", label: "Add a batch" },
  { choice: "newProduct", label: "New product" },
];

const segmentColors = {
  activeContainerColor: colors.ink,
  activeContentColor: colors.ground,
  activeBorderColor: colors.ink,
  inactiveContainerColor: colors.ground,
  inactiveContentColor: colors.ink,
  inactiveBorderColor: colors.hairline,
};
const segmentLabel = {
  fontFamily: fonts.medium,
  fontSize: type.sm.fontSize,
  lineHeight: type.sm.lineHeight,
};
const segmentRow = [fillMaxWidth()];

function MatchChoice({
  choice,
  onChange,
}: {
  readonly choice: CommitChoice;
  readonly onChange: (choice: CommitChoice) => void;
}) {
  return (
    <Host matchContents>
      <SingleChoiceSegmentedButtonRow modifiers={segmentRow}>
        {CHOICES.map((option) => (
          <SegmentedButton
            key={option.choice}
            selected={option.choice === choice}
            onClick={() => onChange(option.choice)}
            colors={segmentColors}
          >
            <SegmentedButton.Label>
              <ComposeText style={segmentLabel}>{option.label}</ComposeText>
            </SegmentedButton.Label>
          </SegmentedButton>
        ))}
      </SingleChoiceSegmentedButtonRow>
    </Host>
  );
}

const packsOnHand = (match: ScanMatch) => {
  const packs = Math.floor(match.availableUnits / match.product.unitsPerPack);
  return `${packs} ${packs === 1 ? "pack" : "packs"} in stock`;
};

type MatchSource = "auto" | "picked";

function LinkButton({
  label,
  accessibilityLabel,
  onPress,
}: {
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={styles.linkButton}
    >
      <Text size="sm" weight="medium" style={styles.link}>
        {label}
      </Text>
    </Pressable>
  );
}

export function MatchCard({
  match,
  source,
  matching,
  choice,
  onChoose,
  onPick,
}: {
  readonly match: ScanMatch | null;
  readonly source: MatchSource;
  readonly matching: boolean;
  readonly choice: CommitChoice;
  readonly onChoose: (choice: CommitChoice) => void;
  readonly onPick: () => void;
}) {
  if (match === null) {
    return (
      <View style={[styles.card, styles.cardColumn]}>
        <View style={styles.cardHeader}>
          <Icon icon={PackageIcon} size={20} color={colors.muted} />
          <View style={styles.cardText}>
            <Text size="sm" weight="medium">
              {matching ? "Matching against your stock" : "Not matched to your stock"}
            </Text>
            <Text size="xs" tone="muted">
              {matching ? "This takes a moment" : "Saving creates a new product"}
            </Text>
          </View>
        </View>
        {matching ? null : (
          <LinkButton
            label="Pick an existing product"
            accessibilityLabel="Pick an existing product instead"
            onPress={onPick}
          />
        )}
      </View>
    );
  }
  const details = [match.composition, match.strength].filter((part) => part !== null).join(" · ");
  const origin = source === "picked" ? "Picked by you" : "Matched in your stock";
  return (
    <View style={[styles.card, styles.cardColumn]}>
      <View style={styles.cardHeader}>
        <Icon icon={PackageIcon} size={20} />
        <View style={styles.cardText}>
          <Text size="xs" tone="muted">
            {origin}
          </Text>
          <Text size="base" weight="medium">
            {match.product.name}
          </Text>
          <Text size="xs" tone="muted">
            {[details, packsOnHand(match)].filter((part) => part !== "").join(" · ")}
          </Text>
        </View>
        <LinkButton
          label="Change"
          accessibilityLabel={`Change the product. Now ${match.product.name}`}
          onPress={onPick}
        />
      </View>
      <MatchChoice choice={choice} onChange={onChoose} />
      {choice === "newProduct" ? (
        <Text size="xs" tone="muted">
          {`Saving creates a new product instead of adding to ${match.product.name}.`}
        </Text>
      ) : null}
    </View>
  );
}

const chipBorder = { width: 1, color: colors.hairline };
const categoryColors = {
  containerColor: colors.ground,
  labelColor: colors.ink,
  selectedContainerColor: colors.ink,
  selectedLabelColor: colors.ground,
};
const lineColors = { containerColor: colors.ground, labelColor: colors.ink };
const chipLabel = {
  fontFamily: fonts.regular,
  fontSize: type.sm.fontSize,
  lineHeight: type.sm.lineHeight,
};
const lineLabel = { ...chipLabel, fontFamily: fonts.mono };
const chipGap = { spacedBy: space[2] };

export function CategoryPicker({
  choices,
  selectedId,
  onSelect,
}: {
  readonly choices: ReadonlyArray<CategoryChoice>;
  readonly selectedId: string | null;
  readonly onSelect: (categoryId: string) => void;
}) {
  if (choices.length === 0) {
    return (
      <View style={styles.categoryRow}>
        <Text size="xs" tone="muted">
          Category
        </Text>
        <Text size="sm">General (created when you save)</Text>
      </View>
    );
  }
  return (
    <View style={styles.categoryRow}>
      <Text size="xs" tone="muted">
        Category
      </Text>
      <Host matchContents={{ vertical: true }} style={styles.chipHost}>
        <FlowRow horizontalArrangement={chipGap}>
          {choices.map((category) => (
            <FilterChip
              key={category.id}
              selected={category.id === selectedId}
              onClick={() => onSelect(category.id)}
              colors={categoryColors}
              border={chipBorder}
            >
              <FilterChip.Label>
                <ComposeText style={chipLabel}>{category.name}</ComposeText>
              </FilterChip.Label>
            </FilterChip>
          ))}
        </FlowRow>
      </Host>
    </View>
  );
}

export function TextChips({
  lines,
  target,
  onPick,
}: {
  readonly lines: ReadonlyArray<string>;
  readonly target: string | null;
  readonly onPick: (line: string) => void;
}) {
  if (lines.length === 0) return null;
  return (
    <View style={styles.chipSection}>
      <Text size="xs" tone="muted">
        {target === null
          ? "Recognised text · select a field, then tap to fill it"
          : `Recognised text · tap to fill ${target}`}
      </Text>
      <Host matchContents={{ vertical: true }} style={styles.chipHost}>
        <FlowRow horizontalArrangement={chipGap}>
          {lines.map((line) => (
            <SuggestionChip
              key={line}
              enabled={target !== null}
              onClick={() => onPick(line)}
              colors={lineColors}
              border={chipBorder}
            >
              <SuggestionChip.Label>
                <ComposeText style={lineLabel}>{line}</ComposeText>
              </SuggestionChip.Label>
            </SuggestionChip>
          ))}
        </FlowRow>
      </Host>
    </View>
  );
}

const BANNER_ICONS = {
  offline: WifiOff01Icon,
  warning: AlertCircleIcon,
  saved: Tick02Icon,
} as const;

export function Banner({
  tone,
  message,
  action,
}: {
  readonly tone: "offline" | "warning" | "saved";
  readonly message: string;
  readonly action?: { readonly label: string; readonly onPress: () => void } | undefined;
}) {
  return (
    <View accessibilityRole="alert" style={styles.banner}>
      <Icon icon={BANNER_ICONS[tone]} size={18} />
      <Text size="sm" style={styles.bannerText}>
        {message}
      </Text>
      {action === undefined ? null : (
        <ActionButton label={action.label} onPress={action.onPress} variant="text" />
      )}
    </View>
  );
}

export function CommitBar({
  label,
  caption,
  error,
  enabled,
  onCommit,
  secondary,
}: {
  readonly label: string;
  readonly caption: string;
  readonly error: string | null;
  readonly enabled: boolean;
  readonly onCommit: () => void;
  readonly secondary?: { readonly label: string; readonly onPress: () => void } | undefined;
}) {
  return (
    <View style={styles.commitBar}>
      {error === null ? null : (
        <Text size="sm" tone="error" accessibilityRole="alert">
          {error}
        </Text>
      )}
      <View style={styles.commitRow}>
        {secondary === undefined ? null : (
          <Pressable
            accessibilityRole="button"
            onPress={secondary.onPress}
            style={styles.secondaryButton}
          >
            <Text size="base" weight="medium">
              {secondary.label}
            </Text>
          </Pressable>
        )}
        <PressScale
          onPress={onCommit}
          enabled={enabled}
          accessibilityLabel={label}
          style={[styles.inkButton, !enabled && styles.inkButtonDisabled]}
        >
          <Text size="base" weight="medium" numberOfLines={1} style={{ color: colors.ground }}>
            {label}
          </Text>
        </PressScale>
      </View>
      <Text size="xs" tone="muted" style={styles.caption}>
        {caption}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  source: {
    flexDirection: "row",
    gap: space[3],
    padding: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  sourcePhoto: {
    width: 56,
    height: 72,
    borderRadius: radius.sm,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.hairline,
  },
  sourceText: { flex: 1 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    padding: space[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  cardColumn: { flexDirection: "column", alignItems: "stretch" },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: space[3] },
  cardText: { flex: 1, gap: 2 },
  linkButton: {
    minHeight: touch.minimum,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: space[2],
  },
  link: { textDecorationLine: "underline" },
  categoryRow: {
    gap: space[2],
    paddingVertical: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  chipSection: { gap: space[2], paddingVertical: space[3] },
  chipHost: { alignSelf: "stretch" },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    padding: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  bannerText: { flex: 1 },
  commitBar: {
    gap: space[2],
    paddingHorizontal: space[4],
    paddingTop: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    backgroundColor: colors.ground,
  },
  commitRow: { flexDirection: "row", gap: space[2] },
  secondaryButton: {
    minHeight: touch.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  inkButton: {
    flex: 1,
    minHeight: touch.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    backgroundColor: colors.ink,
  },
  inkButtonDisabled: { opacity: 0.4 },
  caption: { textAlign: "center" },
});
