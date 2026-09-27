import { useAtomValue } from "@effect/atom-react";
import { Host, List, ListItem } from "@expo/ui";
import { Badge, Row, Text } from "@expo/ui/jetpack-compose";
import { fillMaxWidth, padding, size } from "@expo/ui/jetpack-compose/modifiers";
import {
  minuteClockAtom,
  useCommandExecution,
  useInventoryState,
  useInventorySyncActivity,
  useInventorySyncStatus,
} from "@store/inventory-react";
import { useRouter } from "expo-router";
import * as React from "react";
import { StyleSheet } from "react-native";

import { colors, fonts, space, type } from "@/theme/tokens";

import { ComposeActionButton } from "../action-button";
import { firstFixableProduct, syncActivityView, type RejectedRowView } from "./sync-activity";
import { syncHealthView, type SyncTone } from "./sync-health";

const rowColors = {
  containerColor: colors.ground,
  contentColor: colors.ink,
  supportingContentColor: colors.muted,
  trailingContentColor: colors.ink,
};
const headline = {
  fontFamily: fonts.regular,
  fontSize: type.base.fontSize,
  lineHeight: type.base.lineHeight,
};
const attentionHeadline = { ...headline, background: colors.highlight };
const supporting = {
  fontFamily: fonts.regular,
  fontSize: type.sm.fontSize,
  lineHeight: type.sm.lineHeight,
};
const toneColor = {
  synced: colors.synced,
  pending: colors.muted,
  attention: colors.ink,
  error: colors.error,
} satisfies Record<SyncTone, string>;
const dotModifiers = [size(10, 10)];
const actionRowModifiers = [fillMaxWidth(), padding(space[4], space[4], space[4], space[4])];

export function SyncOverview({ syncNow }: { readonly syncNow: () => Promise<void> }) {
  const state = useInventoryState();
  const [syncing, setSyncing] = React.useState(false);
  const runSync = () => {
    setSyncing(true);
    void syncNow().finally(() => setSyncing(false));
  };
  return (
    <Host style={styles.host}>
      <List onRefresh={syncNow}>
        {state._tag === "Ready" ? (
          <ReadyRows />
        ) : state._tag === "Opening" ? (
          <StatusRow
            tone="pending"
            title="Opening local storage"
            detail="Your stock is loading from this phone."
          />
        ) : (
          <StatusRow
            tone="error"
            title="Local storage didn't open"
            detail={state.error}
            action={<ComposeActionButton label="Try again" onPress={state.retry} variant="text" />}
          />
        )}
        <Row horizontalArrangement="end" modifiers={actionRowModifiers}>
          <ComposeActionButton
            disabled={syncing}
            label={syncing ? "Syncing" : "Sync now"}
            onPress={runSync}
          />
        </Row>
      </List>
    </Host>
  );
}

function ReadyRows() {
  const { push } = useRouter();
  const status = useInventorySyncStatus();
  const activity = useInventorySyncActivity();
  const execution = useCommandExecution();
  const now = useAtomValue(minuteClockAtom);
  const health = syncHealthView(status);
  const view = syncActivityView(activity, now);
  const openProduct = (productId: string) =>
    push({ pathname: "/stock/[productId]", params: { productId } });
  const fixableProduct = firstFixableProduct(activity);
  return (
    <>
      <StatusRow
        tone={health.tone}
        title={health.title}
        detail={health.detail}
        action={
          health.canFix && fixableProduct !== null ? (
            <ComposeActionButton
              label="Fix"
              onPress={() => openProduct(fixableProduct)}
              variant="outlined"
            />
          ) : null
        }
      />
      <StatusRow
        tone={activity.pendingCount === 0 ? "synced" : "pending"}
        title={view.pending.title}
        detail={view.pending.detail}
      />
      <StatusRow
        tone={activity.lastCaughtUpAt === null ? "pending" : "synced"}
        title={view.lastSynced.title}
        detail={view.lastSynced.detail}
      />
      {view.rejected.map((row) => (
        <RejectedRow key={row.key} row={row} onFix={openProduct} />
      ))}
      {view.hiddenRejected > 0 ? (
        <StatusRow
          tone="attention"
          title={`${view.hiddenRejected} older rejected changes`}
          detail="Only the most recent rejections are listed here."
        />
      ) : null}
      {execution._tag === "failed" ? (
        <StatusRow tone="error" title="Last change wasn't saved" detail={execution.message} />
      ) : null}
    </>
  );
}

function RejectedRow({
  row,
  onFix,
}: {
  readonly row: RejectedRowView;
  readonly onFix: (productId: string) => void;
}) {
  const { productId } = row;
  return (
    <StatusRow
      tone="attention"
      title={row.title}
      detail={row.detail}
      action={
        productId === null ? null : (
          <ComposeActionButton label="Fix" onPress={() => onFix(productId)} variant="outlined" />
        )
      }
    />
  );
}

function StatusRow({
  tone,
  title,
  detail,
  action = null,
}: {
  readonly tone: SyncTone;
  readonly title: string;
  readonly detail: string;
  readonly action?: React.ReactNode;
}) {
  return (
    <ListItem colors={rowColors}>
      <ListItem.Leading>
        <Badge containerColor={toneColor[tone]} modifiers={dotModifiers} />
      </ListItem.Leading>
      <Text style={tone === "attention" ? attentionHeadline : headline}>{title}</Text>
      <ListItem.Supporting>
        <Text style={supporting}>{detail}</Text>
      </ListItem.Supporting>
      {action === null ? null : <ListItem.Trailing>{action}</ListItem.Trailing>}
    </ListItem>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
});
