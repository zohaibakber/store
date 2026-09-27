import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import * as React from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, space } from "@/theme/tokens";
import { Text } from "@/ui/text";

import { useScanDrafts } from "../drafts";
import { isAwaitingParse } from "../model";
import { DraftRow, type DraftRowItem } from "../review/draft-row";
import { Banner } from "../review/parts";
import { draftStatus, draftSubtitle, draftTitle } from "../status";
import { ConfirmDialog, type ConfirmRequest } from "../ui/confirm-dialog";
import { ScreenHeader } from "../ui/screen-header";
import { useNow } from "../use-now";

const openDraft = (draftId: string) =>
  router.push({ pathname: "/scan/review", params: { draftId } });

const rowKey = (item: DraftRowItem) => item.id;

export function DraftsScreen() {
  const insets = useSafeAreaInsets();
  const drafts = useScanDrafts();
  const now = useNow(drafts.drafts.some((draft) => draft.parse._tag === "RateLimited"));
  const waiting = drafts.drafts.filter((draft) => isAwaitingParse(draft.parse));
  const [confirmRequest, setConfirmRequest] = React.useState<ConfirmRequest | null>(null);

  const rows = React.useMemo<ReadonlyArray<DraftRowItem>>(
    () =>
      drafts.drafts.map((draft) => ({
        id: draft.id,
        photoUri: draft.photoUri,
        title: draftTitle(draft),
        subtitle: `${draft.mode === "batch" ? "Batch" : "Product"} · ${draftSubtitle(draft, now)}`,
        trailing: draft.mode === "batch" ? `×${draft.packs}` : null,
        status: draftStatus(draft, drafts.parsing.has(draft.id), null),
      })),
    [drafts.drafts, drafts.parsing, now],
  );

  const { removeDraft, requestParse } = drafts;
  const requestDelete = React.useCallback(
    (draftId: string) =>
      setConfirmRequest({
        title: "Delete this scan?",
        body: "The photo and anything you typed are deleted from this phone.",
        confirmLabel: "Delete",
        cancelLabel: "Keep",
        onConfirm: () => removeDraft(draftId),
      }),
    [removeDraft],
  );
  const renderRow = React.useCallback(
    ({ item }: { readonly item: DraftRowItem }) => (
      <DraftRow {...item} onOpen={openDraft} onDelete={requestDelete} />
    ),
    [requestDelete],
  );

  const autoFillAll = () => {
    for (const draft of waiting) requestParse(draft.id);
  };

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <ScreenHeader
        title="Saved scans"
        subtitle={
          drafts.drafts.length === 0
            ? undefined
            : `${drafts.drafts.length} kept on this phone until you add them`
        }
        action={
          drafts.online && waiting.length > 0
            ? { label: "Auto-fill now", onPress: autoFillAll }
            : undefined
        }
      />
      {drafts.lastCommit === null ? null : (
        <View style={styles.banner}>
          <Banner tone="saved" message={`Saved · syncing. ${drafts.lastCommit}.`} />
        </View>
      )}
      {!drafts.online && waiting.length > 0 ? (
        <View style={styles.banner}>
          <Banner
            tone="offline"
            message="Offline, so no auto-fill. These scans fill in when you reconnect."
          />
        </View>
      ) : null}
      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Text size="base" tone="muted">
            {drafts.loaded ? "No saved scans." : "Opening saved scans…"}
          </Text>
        </View>
      ) : (
        <FlashList data={rows} renderItem={renderRow} keyExtractor={rowKey} />
      )}
      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  banner: { padding: space[4] },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
});
