import "@sentry/electron/preload";
import type {
  IssuedSession,
  OrganizationCommand,
  OrganizationCommandResult,
  OrganizationRoster,
} from "@store/auth";
import type { InvoiceExtraction } from "@store/contracts/server-api.schema";
import type { UpdaterEvent } from "@store/contracts/updater";
import type { WorkspaceSnapshot } from "@store/contracts/workspace";
import { ipcRenderer, contextBridge } from "electron";

import { makeReplayChannel, type ReplayChannel } from "../src/replay-channel";
import {
  BACKUP_SAVE_CHANNEL,
  RESTORE_APPLY_CHANNEL,
  RESTORE_CHOOSE_CHANNEL,
  RESTORE_DISCARD_CHANNEL,
  type WorkspaceBackupIpcBridge,
} from "./backup-channels";
import { INVENTORY_HTTP_CONFIG_CHANNEL, type InventoryHttpBridge } from "./inventory-http-channels";
import { NEW_SALE_CHANNEL } from "./new-sale-channels";
import { isOAuthCallbackUrl, OAUTH_CALLBACK_CHANNEL } from "./oauth-callback";
import {
  PUBLISH_DISCARD_CHANNEL,
  PUBLISH_LOCAL_CATALOG_CHANNEL,
  PUBLISH_OFFER_CHANNEL,
  PUBLISH_PROGRESS_CHANNEL,
  PUBLISH_START_CHANNEL,
  type WorkspacePublishIpcBridge,
} from "./publish-channels";
import {
  REPLICA_ANALYTICS_CHANNEL,
  REPLICA_CANCEL_READ_CHANNEL,
  REPLICA_COMMAND_STATUS_CHANNEL,
  REPLICA_CLOSE_CHANNEL,
  REPLICA_COMMIT_CHANNEL,
  REPLICA_ENQUEUE_CHANNEL,
  REPLICA_ACTIVITY_CHANNEL,
  REPLICA_OPEN_CHANNEL,
  REPLICA_INSIGHTS_SUMMARY_CHANNEL,
  REPLICA_OUTBOX_CHANNEL,
  REPLICA_PRODUCT_INSIGHTS_CHANNEL,
  REPLICA_READ_BATCH_CHANNEL,
  REPLICA_READ_INSIGHTS_CHANNEL,
  REPLICA_READ_SUBSET_CHANNEL,
  REPLICA_RESTOCK_PAGE_CHANNEL,
  REPLICA_RETRY_CHANNEL,
  REPLICA_STAMP_CHANNEL,
  REPLICA_SUMMARIZE_SUBSET_CHANNEL,
  REPLICA_SYNC_HEALTH_CHANNEL,
  REPLICA_WAKE_CHANNEL,
  type ReplicaAnalyticsEvent,
  type ReplicaCommitEvent,
  type ReplicaIpcBridge,
  type ReplicaSyncHealthEvent,
} from "./replica-channels";
import {
  SHARE_COPY_TEXT_CHANNEL,
  SHARE_OPEN_EXTERNAL_CHANNEL,
  SHARE_SAVE_PDF_CHANNEL,
  type ShareIpcBridge,
} from "./share-channels";

const invoke = <Result, Arguments extends ReadonlyArray<unknown> = []>(
  channel: string,
  ...args: Arguments
): Promise<Result> => ipcRenderer.invoke(channel, ...args);

const inventoryHttp: InventoryHttpBridge = {
  getConfig: () => ipcRenderer.invoke(INVENTORY_HTTP_CONFIG_CHANNEL),
};

contextBridge.exposeInMainWorld("inventoryHttp", inventoryHttp);

const syncHealthReplays = new Map<string, ReplayChannel<ReplicaSyncHealthEvent["health"]>>();

const syncHealthReplay = (workspaceToken: string) => {
  const existing = syncHealthReplays.get(workspaceToken);
  if (existing) return existing;
  const created = makeReplayChannel<ReplicaSyncHealthEvent["health"]>();
  syncHealthReplays.set(workspaceToken, created);
  return created;
};

ipcRenderer.on(REPLICA_SYNC_HEALTH_CHANNEL, (_event, notice: ReplicaSyncHealthEvent) => {
  syncHealthReplay(notice.workspaceToken).publish(notice.health);
});

const replica: ReplicaIpcBridge = {
  open: (input) => ipcRenderer.invoke(REPLICA_OPEN_CHANNEL, input),
  close: (workspaceToken) => {
    syncHealthReplays.delete(workspaceToken);
    return ipcRenderer.invoke(REPLICA_CLOSE_CHANNEL, workspaceToken);
  },
  stamp: (workspaceToken) => ipcRenderer.invoke(REPLICA_STAMP_CHANNEL, workspaceToken),
  readSubset: (input) => ipcRenderer.invoke(REPLICA_READ_SUBSET_CHANNEL, input),
  readBatch: (input) => ipcRenderer.invoke(REPLICA_READ_BATCH_CHANNEL, input),
  cancelRead: (input) => ipcRenderer.invoke(REPLICA_CANCEL_READ_CHANNEL, input),
  retryRecovery: (workspaceToken) => ipcRenderer.invoke(REPLICA_RETRY_CHANNEL, workspaceToken),
  readInsights: (input) => ipcRenderer.invoke(REPLICA_READ_INSIGHTS_CHANNEL, input),
  summarizeSubset: (input) => ipcRenderer.invoke(REPLICA_SUMMARIZE_SUBSET_CHANNEL, input),
  readInsightsSummary: (input) => ipcRenderer.invoke(REPLICA_INSIGHTS_SUMMARY_CHANNEL, input),
  readProductInsights: (input) => ipcRenderer.invoke(REPLICA_PRODUCT_INSIGHTS_CHANNEL, input),
  readRestockPage: (input) => ipcRenderer.invoke(REPLICA_RESTOCK_PAGE_CHANNEL, input),
  onAnalytics(callback) {
    const listener = (_event: Electron.IpcRendererEvent, event: ReplicaAnalyticsEvent) =>
      callback(event);
    ipcRenderer.on(REPLICA_ANALYTICS_CHANNEL, listener);
    return () => ipcRenderer.off(REPLICA_ANALYTICS_CHANNEL, listener);
  },
  readOutboxStatuses: (workspaceToken) =>
    ipcRenderer.invoke(REPLICA_OUTBOX_CHANNEL, workspaceToken),
  readSyncActivity: (workspaceToken) =>
    ipcRenderer.invoke(REPLICA_ACTIVITY_CHANNEL, workspaceToken),
  enqueueCommand: (input) => ipcRenderer.invoke(REPLICA_ENQUEUE_CHANNEL, input),
  readCommandStatus: (input) => ipcRenderer.invoke(REPLICA_COMMAND_STATUS_CHANNEL, input),
  wakeSyncUpload: (workspaceToken) => ipcRenderer.invoke(REPLICA_WAKE_CHANNEL, workspaceToken),
  onCommit(callback) {
    const listener = (_event: Electron.IpcRendererEvent, event: ReplicaCommitEvent) =>
      callback(event);
    ipcRenderer.on(REPLICA_COMMIT_CHANNEL, listener);
    return () => ipcRenderer.off(REPLICA_COMMIT_CHANNEL, listener);
  },
  onSyncHealth: (workspaceToken, callback) => syncHealthReplay(workspaceToken).subscribe(callback),
};

contextBridge.exposeInMainWorld("replica", replica);

const workspaceBackup: WorkspaceBackupIpcBridge = {
  backUp: () => ipcRenderer.invoke(BACKUP_SAVE_CHANNEL),
  chooseRestore: () => ipcRenderer.invoke(RESTORE_CHOOSE_CHANNEL),
  applyRestore: () => ipcRenderer.invoke(RESTORE_APPLY_CHANNEL),
  discardRestore: () => ipcRenderer.invoke(RESTORE_DISCARD_CHANNEL),
};

contextBridge.exposeInMainWorld("workspaceBackup", workspaceBackup);

const sharing: ShareIpcBridge = {
  openExternal: (url) => ipcRenderer.invoke(SHARE_OPEN_EXTERNAL_CHANNEL, url),
  copyText: (text) => ipcRenderer.invoke(SHARE_COPY_TEXT_CHANNEL, text),
  savePdf: (fileStem) => ipcRenderer.invoke(SHARE_SAVE_PDF_CHANNEL, fileStem),
};

contextBridge.exposeInMainWorld("sharing", sharing);

const workspacePublish: WorkspacePublishIpcBridge = {
  offer: (organizationId) => ipcRenderer.invoke(PUBLISH_OFFER_CHANNEL, organizationId),
  publish: (organizationId) => ipcRenderer.invoke(PUBLISH_START_CHANNEL, organizationId),
  discard: (organizationId) => ipcRenderer.invoke(PUBLISH_DISCARD_CHANNEL, organizationId),
  localCatalog: () => ipcRenderer.invoke(PUBLISH_LOCAL_CATALOG_CHANNEL),
  onProgress(callback) {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: Parameters<typeof callback>[0],
    ) => callback(progress);
    ipcRenderer.on(PUBLISH_PROGRESS_CHANNEL, listener);
    return () => ipcRenderer.off(PUBLISH_PROGRESS_CHANNEL, listener);
  },
};

contextBridge.exposeInMainWorld("workspacePublish", workspacePublish);

const sessionReplay = makeReplayChannel<WorkspaceSnapshot>();
ipcRenderer.on("auth:session-changed", (_event, snapshot: WorkspaceSnapshot) => {
  sessionReplay.publish(snapshot);
});

const oauthCallbackScheme = globalThis.location.protocol.slice(0, -1);
const oauthCallbackListeners = new Set<(url: string) => void>();
let unclaimedOAuthCallback: string | null = null;

ipcRenderer.on(OAUTH_CALLBACK_CHANNEL, (_event, url: string) => {
  if (!isOAuthCallbackUrl(url, oauthCallbackScheme)) return;
  if (oauthCallbackListeners.size === 0) {
    unclaimedOAuthCallback = url;
    return;
  }
  for (const listener of oauthCallbackListeners) listener(url);
});

contextBridge.exposeInMainWorld("auth", {
  getSession: async () => {
    const snapshot = await invoke<WorkspaceSnapshot>("auth:get-session");
    sessionReplay.publish(snapshot);
    return snapshot;
  },
  adoptSession: async (issued: IssuedSession | null) => {
    const snapshot = await invoke<WorkspaceSnapshot, [IssuedSession | null]>(
      "auth:adopt-session",
      issued,
    );
    sessionReplay.publish(snapshot);
    return snapshot;
  },
  renewSession: async () => {
    const snapshot = await invoke<WorkspaceSnapshot>("auth:renew-session");
    sessionReplay.publish(snapshot);
    return snapshot;
  },
  signOut: () => invoke<void>("auth:sign-out"),
  organizationRoster: () => invoke<OrganizationRoster>("auth:organization"),
  organize: (command: OrganizationCommand) =>
    invoke<OrganizationCommandResult, [OrganizationCommand]>("auth:organize", command),
  openExternal: (url: string) => invoke<void, [string]>("auth:open-external", url),
  getOAuthRedirectUri: () => invoke<string>("auth:get-oauth-redirect-uri"),
  onOAuthCallback(callback: (url: string) => void) {
    oauthCallbackListeners.add(callback);
    const unclaimed = unclaimedOAuthCallback;
    unclaimedOAuthCallback = null;
    if (unclaimed) callback(unclaimed);
    return () => {
      oauthCallbackListeners.delete(callback);
    };
  },
  onSessionChange(callback: (snapshot: WorkspaceSnapshot) => void) {
    return sessionReplay.subscribe(callback);
  },
});

contextBridge.exposeInMainWorld("serverApi", {
  analyseInvoices: (input: {
    files: Array<{ name: string; type: string; bytes: ArrayBuffer }>;
  }): Promise<InvoiceExtraction> => ipcRenderer.invoke("server:uploads", input),
});

contextBridge.exposeInMainWorld("electronTheme", {
  setSource(source: "dark" | "light" | "system") {
    ipcRenderer.send("theme:set-source", source);
  },
});

contextBridge.exposeInMainWorld("desktopShell", {
  onNewSale(callback: () => void) {
    const listener = () => callback();
    ipcRenderer.on(NEW_SALE_CHANNEL, listener);
    return () => ipcRenderer.off(NEW_SALE_CHANNEL, listener);
  },
});

if (import.meta.env.PROD) {
  contextBridge.exposeInMainWorld("updater", {
    check: () => invoke<void>("updater:check"),
    download: () => invoke<void>("updater:download"),
    install() {
      ipcRenderer.send("updater:install");
    },
    onEvent(callback: (event: UpdaterEvent) => void) {
      const listener = (_event: Electron.IpcRendererEvent, updaterEvent: UpdaterEvent) =>
        callback(updaterEvent);
      ipcRenderer.on("updater:event", listener);
      return () => ipcRenderer.off("updater:event", listener);
    },
  });
}
