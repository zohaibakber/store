import { BottomSheet, RNHostView } from "@expo/ui";
import { Add01Icon, PackageIcon, Search01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import * as React from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";

import { colors, fonts, radius, space, touch, type } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";

import { type ScanMatch, useProductChoices } from "../catalog";

const sheetPadding = { top: space[2], bottom: 0, left: 0, right: 0 };
const ripple = { color: colors.hairline };

const stockText = (match: ScanMatch) => {
  const packs = Math.floor(match.availableUnits / match.product.unitsPerPack);
  return `${packs} ${packs === 1 ? "pack" : "packs"} in stock`;
};

const detailText = (match: ScanMatch) =>
  [match.composition, match.strength, stockText(match)]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ");

const ChoiceRow = React.memo(function ChoiceRow({
  match,
  selected,
  onPick,
}: {
  readonly match: ScanMatch;
  readonly selected: boolean;
  readonly onPick: (match: ScanMatch) => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${match.product.name}. ${detailText(match)}`}
      android_ripple={ripple}
      onPress={() => onPick(match)}
      style={styles.row}
    >
      <Icon icon={PackageIcon} size={20} color={colors.muted} />
      <View style={styles.rowText}>
        <Text size="base" numberOfLines={1}>
          {match.product.name}
        </Text>
        <Text size="xs" tone="muted" numberOfLines={1}>
          {detailText(match)}
        </Text>
      </View>
      {selected ? <Icon icon={Tick02Icon} size={20} /> : null}
    </Pressable>
  );
});

function PickerContent({
  initialQuery,
  selectedId,
  newName,
  onPick,
  onNewProduct,
}: {
  readonly initialQuery: string;
  readonly selectedId: string | null;
  readonly newName: string;
  readonly onPick: (match: ScanMatch) => void;
  readonly onNewProduct: () => void;
}) {
  const [query, setQuery] = React.useState(initialQuery);
  const deferredQuery = React.useDeferredValue(query);
  const { choices, isLoading } = useProductChoices(deferredQuery);
  const trimmed = newName.trim();
  const searched = deferredQuery.trim();
  return (
    <View style={styles.content}>
      <Text size="lg" weight="medium" style={styles.title}>
        Which product is this?
      </Text>
      <View style={styles.search}>
        <Icon icon={Search01Icon} size={20} color={colors.muted} />
        <TextInput
          accessibilityLabel="Search your products"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          cursorColor={colors.ink}
          defaultValue={initialQuery}
          onChangeText={setQuery}
          placeholder="Search your products"
          placeholderTextColor={colors.placeholder}
          returnKeyType="search"
          selectionColor={colors.highlight}
          selectTextOnFocus
          style={styles.input}
        />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Pressable
          accessibilityRole="button"
          android_ripple={ripple}
          onPress={onNewProduct}
          style={styles.row}
        >
          <Icon icon={Add01Icon} size={20} />
          <View style={styles.rowText}>
            <Text size="base" weight="medium" numberOfLines={1}>
              {trimmed ? `New product: ${trimmed}` : "New product"}
            </Text>
            <Text size="xs" tone="muted">
              Not in your stock yet
            </Text>
          </View>
        </Pressable>
        {choices.map((match) => (
          <ChoiceRow
            key={match.product.id}
            match={match}
            selected={match.product.id === selectedId}
            onPick={onPick}
          />
        ))}
        {choices.length === 0 && !isLoading ? (
          <Text tone="muted" style={styles.empty}>
            {searched
              ? `Nothing in your stock matches "${searched}".`
              : "Your stock has no products yet."}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

export function ProductPicker({
  open,
  initialQuery,
  selectedId,
  newName,
  onPick,
  onNewProduct,
  onClose,
}: {
  readonly open: boolean;
  readonly initialQuery: string;
  readonly selectedId: string | null;
  readonly newName: string;
  readonly onPick: (match: ScanMatch) => void;
  readonly onNewProduct: () => void;
  readonly onClose: () => void;
}) {
  return (
    <BottomSheet
      isPresented={open}
      onDismiss={onClose}
      snapPoints={["full"]}
      containerColor={colors.ground}
      contentPadding={sheetPadding}
    >
      <RNHostView>
        <PickerContent
          initialQuery={initialQuery}
          selectedId={selectedId}
          newName={newName}
          onPick={onPick}
          onNewProduct={onNewProduct}
        />
      </RNHostView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, gap: space[2] },
  title: { paddingHorizontal: space[4] },
  search: {
    height: touch.primary,
    marginHorizontal: space[4],
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    ...type.base,
    fontFamily: fonts.regular,
    color: colors.ink,
    paddingVertical: 0,
  },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  rowText: { flex: 1, gap: 2 },
  empty: { padding: space[4] },
});
