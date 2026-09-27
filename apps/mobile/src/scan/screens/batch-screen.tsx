import { FlashList } from "@shopify/flash-list";
import { useCatalogIsReady } from "@store/inventory-react";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import * as React from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, space } from "@/theme/tokens";
import { Text } from "@/ui/text";

import {
  type ExecutablePlan,
  identityOf,
  useCategoryChoices,
  useCatalogMatcher,
  useScanCommit,
} from "../catalog";
import { useScanDrafts } from "../drafts";
import type { MatchedProduct } from "../fields";
import type { ScanIdentity } from "../matching";
import { DraftRow, type DraftRowItem } from "../review/draft-row";
import { Banner, CommitBar } from "../review/parts";
import { batchRow, countStatuses, draftSubtitle, draftTitle, statusSummary } from "../status";
import { ScreenHeader } from "../ui/screen-header";
import { useNow } from "../use-now";

type Matcher = (identity: ScanIdentity) => MatchedProduct | null;

type BatchCatalog = {
  readonly matcher: Matcher;
  readonly commit: (plan: ExecutablePlan, categoryId: string | null) => Promise<void>;
  readonly categoryId: string | null;
};

type ReadyItem = { readonly draftId: string; readonly plan: ExecutablePlan };

const openDraft = (draftId: string) =>
  router.push({ pathname: "/scan/review", params: { draftId } });

const renderRow = ({ item }: { readonly item: DraftRowItem }) => (
  <DraftRow {...item} onOpen={openDraft} />
);

const rowKey = (item: DraftRowItem) => item.id;

const failureMessage = (cause: unknown) =>
  cause instanceof Error && cause.message ? cause.message : "Could not save on this phone.";

function BatchList({ catalog }: { readonly catalog: BatchCatalog | null }) {
  const insets = useSafeAreaInsets();
  const drafts = useScanDrafts();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const batchDrafts = drafts.drafts.filter((draft) => draft.mode === "batch");
  const now = useNow(batchDrafts.some((draft) => draft.parse._tag === "RateLimited"));

  const { rows, ready } = React.useMemo(() => {
    const items: Array<DraftRowItem> = [];
    const readyItems: Array<ReadyItem> = [];
    for (const draft of batchDrafts) {
      const match = catalog === null ? null : catalog.matcher(identityOf(draft));
      const row = batchRow(draft, drafts.parsing.has(draft.id), match);
      if (row.plan !== null) readyItems.push({ draftId: draft.id, plan: row.plan });
      const action = match === null ? "New product" : "Add a batch";
      items.push({
        id: draft.id,
        photoUri: draft.photoUri,
        title: match?.name ?? draftTitle(draft),
        subtitle: `${action} · ${draftSubtitle(draft, now)}`,
        trailing: `×${draft.packs}`,
        status: catalog === null && row.status === "ready" ? "check" : row.status,
      });
    }
    return { rows: items, ready: catalog === null ? [] : readyItems };
  }, [batchDrafts, catalog, drafts.parsing, now]);

  const counts = countStatuses(rows.map((row) => row.status));

  const commitReady = async () => {
    if (catalog === null || saving || ready.length === 0) return;
    setSaving(true);
    setError(null);
    let saved = 0;
    try {
      for (const item of ready) {
        await catalog.commit(item.plan, catalog.categoryId);
        drafts.removeDraft(item.draftId);
        saved += 1;
      }
    } catch (cause) {
      setError(failureMessage(cause));
    }
    setSaving(false);
    if (saved === 0) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    drafts.noteCommit(`Added ${saved} ${saved === 1 ? "item" : "items"}`);
    if (saved === rows.length) router.back();
  };

  const label =
    ready.length === 0
      ? "Nothing ready to add"
      : `Add ${ready.length} ready ${ready.length === 1 ? "item" : "items"}`;

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Batch review" subtitle={statusSummary(counts)} />
      {catalog === null ? (
        <View style={styles.banner}>
          <Banner tone="warning" message="Your stock is still opening on this phone." />
        </View>
      ) : null}
      {drafts.lastCommit === null ? null : (
        <View style={styles.banner}>
          <Banner tone="saved" message={`Saved · syncing. ${drafts.lastCommit}.`} />
        </View>
      )}
      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Text size="base" tone="muted">
            No batch scans yet.
          </Text>
        </View>
      ) : (
        <FlashList data={rows} renderItem={renderRow} keyExtractor={rowKey} />
      )}
      <View style={{ paddingBottom: insets.bottom + space[2] }}>
        <CommitBar
          label={label}
          caption={
            counts.check + counts.reading > 0
              ? "Items to check and items still reading stay here"
              : "Saved on this phone first, then synced"
          }
          error={error}
          enabled={catalog !== null && ready.length > 0 && !saving}
          onCommit={() => void commitReady()}
        />
      </View>
    </View>
  );
}

function BatchWithCatalog() {
  const matchCandidate = useCatalogMatcher();
  const commit = useScanCommit();
  const { preferredId } = useCategoryChoices();
  const catalog = React.useMemo<BatchCatalog>(
    () => ({
      matcher: (identity) => {
        const candidate = matchCandidate(identity);
        return candidate === null
          ? null
          : { id: candidate.id, name: candidate.name, unitsPerPack: candidate.unitsPerPack };
      },
      commit,
      categoryId: preferredId,
    }),
    [matchCandidate, commit, preferredId],
  );
  return <BatchList catalog={catalog} />;
}

export function BatchScreen() {
  const catalogReady = useCatalogIsReady();
  return catalogReady ? <BatchWithCatalog /> : <BatchList catalog={null} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  banner: { padding: space[4] },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
});
