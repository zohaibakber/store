import "@sentry/electron/preload";
import type { ElectronReplicaBridge } from "@store/client-db";
import type { UpdaterEvent } from "@store/contracts/updater";
import type { WorkspaceSnapshot } from "@store/contracts/workspace";
import type {
  AuthIpcBridge,
  InventoryHttpBridge,
  ServerApiIpcBridge,
} from "@store/web/host/electron";
import type { AppUpdaterBridge, DesktopShellBridge, ThemeBridge } from "@store/web/host/index";
import { makeReplayChannel, type ReplayChannel } from "@store/web/host/replay-channel";
import type { ShareBridge } from "@store/web/host/share";
import type { WorkspaceBackupBridge } from "@store/web/host/workspace-backup";
import type { WorkspacePublishBridge } from "@store/web/host/workspace-publish";
import { ipcRenderer, contextBridge } from "electron";

import {
  AUTH_AUTHENTICATE_CHANNEL,
  AUTH_BEGIN_GOOGLE_CHANNEL,
  AUTH_COMPLETE_GOOGLE_CHANNEL,
  AUTH_GET_SESSION_CHANNEL,
  AUTH_IDENTIFY_CHANNEL,
  AUTH_ORGANIZATION_CHANNEL,
  AUTH_ORGANIZE_CHANNEL,
  AUTH_RENEW_SESSION_CHANNEL,
  AUTH_SESSION_CHANGED_CHANNEL,
  AUTH_SIGN_OUT_CHANNEL,
  BACKUP_SAVE_CHANNEL,
  INVENTORY_HTTP_CONFIG_CHANNEL,
  NEW_SALE_CHANNEL,
  OAUTH_CALLBACK_CHANNEL,
  PUBLISH_DISCARD_CHANNEL,
  PUBLISH_LOCAL_CATALOG_CHANNEL,
  PUBLISH_OFFER_CHANNEL,
  PUBLISH_PROGRESS_CHANNEL,
  PUBLISH_START_CHANNEL,
  REPLICA_ACTIVITY_CHANNEL,
  REPLICA_ANALYTICS_CHANNEL,
  REPLICA_CANCEL_READ_CHANNEL,
  REPLICA_CLOSE_CHANNEL,
  REPLICA_COMMAND_STATUS_CHANNEL,
  REPLICA_COMMIT_CHANNEL,
  REPLICA_ENQUEUE_CHANNEL,
  REPLICA_INSIGHTS_SUMMARY_CHANNEL,
  REPLICA_OPEN_CHANNEL,
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
  RESTORE_APPLY_CHANNEL,
  RESTORE_CHOOSE_CHANNEL,
  RESTORE_DISCARD_CHANNEL,
  SERVER_DEVICE_COMMAND_CHANNEL,
  SERVER_DEVICES_CHANNEL,
  SERVER_GLOBAL_SEARCH_CHANNEL,
  SERVER_UPLOADS_CHANNEL,
  SHARE_COPY_TEXT_CHANNEL,
  SHARE_OPEN_EXTERNAL_CHANNEL,
  SHARE_PRINT_CHANNEL,
  SHARE_SAVE_PDF_CHANNEL,
  THEME_SET_SOURCE_CHANNEL,
  UPDATER_CHECK_CHANNEL,
  UPDATER_DOWNLOAD_CHANNEL,
  UPDATER_EVENT_CHANNEL,
  UPDATER_INSTALL_CHANNEL,
  WINDOW_CLOSE_CHANNEL,
  WINDOW_MAXIMIZED_CHANNEL,
  WINDOW_MINIMIZE_CHANNEL,
  WINDOW_TOGGLE_MAXIMIZE_CHANNEL,
  type ReplicaAnalyticsEvent,
  type ReplicaCommitEvent,
  type ReplicaSyncHealthEvent,
} from "./ipc-channels";
import { isOAuthCallbackUrl } from "./oauth-callback";

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

const replica: ElectronReplicaBridge = {
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

const workspaceBackup: WorkspaceBackupBridge = {
  backUp: () => ipcRenderer.invoke(BACKUP_SAVE_CHANNEL),
  chooseRestore: () => ipcRenderer.invoke(RESTORE_CHOOSE_CHANNEL),
  applyRestore: () => ipcRenderer.invoke(RESTORE_APPLY_CHANNEL),
  discardRestore: () => ipcRenderer.invoke(RESTORE_DISCARD_CHANNEL),
};

contextBridge.exposeInMainWorld("workspaceBackup", workspaceBackup);

const sharing: ShareBridge = {
  openExternal: (url) => ipcRenderer.invoke(SHARE_OPEN_EXTERNAL_CHANNEL, url),
  copyText: (text) => ipcRenderer.invoke(SHARE_COPY_TEXT_CHANNEL, text),
  savePdf: (fileStem) => ipcRenderer.invoke(SHARE_SAVE_PDF_CHANNEL, fileStem),
  print: (page) => ipcRenderer.invoke(SHARE_PRINT_CHANNEL, page),
};

contextBridge.exposeInMainWorld("sharing", sharing);

const workspacePublish: WorkspacePublishBridge = {
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
ipcRenderer.on(AUTH_SESSION_CHANGED_CHANNEL, (_event, snapshot: WorkspaceSnapshot) => {
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

const publishedSession = async (snapshot: Promise<WorkspaceSnapshot>) => {
  const settled = await snapshot;
  sessionReplay.publish(settled);
  return settled;
};

const auth: AuthIpcBridge = {
  getSession: () => publishedSession(ipcRenderer.invoke(AUTH_GET_SESSION_CHANNEL)),
  identify: (input) => ipcRenderer.invoke(AUTH_IDENTIFY_CHANNEL, input),
  authenticate: (credentials) =>
    publishedSession(ipcRenderer.invoke(AUTH_AUTHENTICATE_CHANNEL, credentials)),
  beginGoogle: () => ipcRenderer.invoke(AUTH_BEGIN_GOOGLE_CHANNEL),
  completeGoogle: async (callbackUrl) => {
    const snapshot: WorkspaceSnapshot | null = await ipcRenderer.invoke(
      AUTH_COMPLETE_GOOGLE_CHANNEL,
      callbackUrl,
    );
    if (snapshot !== null) sessionReplay.publish(snapshot);
    return snapshot;
  },
  renewSession: () => publishedSession(ipcRenderer.invoke(AUTH_RENEW_SESSION_CHANNEL)),
  signOut: () => ipcRenderer.invoke(AUTH_SIGN_OUT_CHANNEL),
  organizationRoster: () => ipcRenderer.invoke(AUTH_ORGANIZATION_CHANNEL),
  organize: (command) => ipcRenderer.invoke(AUTH_ORGANIZE_CHANNEL, command),
  onOAuthCallback(callback) {
    oauthCallbackListeners.add(callback);
    const unclaimed = unclaimedOAuthCallback;
    unclaimedOAuthCallback = null;
    if (unclaimed) callback(unclaimed);
    return () => {
      oauthCallbackListeners.delete(callback);
    };
  },
  onSessionChange: (callback) => sessionReplay.subscribe(callback),
};

contextBridge.exposeInMainWorld("auth", auth);

const serverApi: ServerApiIpcBridge = {
  analyseInvoices: (input) => ipcRenderer.invoke(SERVER_UPLOADS_CHANNEL, input),
  searchGlobalProducts: (input) => ipcRenderer.invoke(SERVER_GLOBAL_SEARCH_CHANNEL, input),
  organizationDevices: () => ipcRenderer.invoke(SERVER_DEVICES_CHANNEL),
  commandDevice: (command) => ipcRenderer.invoke(SERVER_DEVICE_COMMAND_CHANNEL, command),
};

contextBridge.exposeInMainWorld("serverApi", serverApi);

const electronTheme: ThemeBridge = {
  setSource(source) {
    ipcRenderer.send(THEME_SET_SOURCE_CHANNEL, source);
  },
};

contextBridge.exposeInMainWorld("electronTheme", electronTheme);

const windowMaximized = makeReplayChannel<boolean>();
ipcRenderer.on(WINDOW_MAXIMIZED_CHANNEL, (_event, maximized: boolean) =>
  windowMaximized.publish(maximized),
);

const desktopShell: DesktopShellBridge = {
  onNewSale(callback) {
    const listener = () => callback();
    ipcRenderer.on(NEW_SALE_CHANNEL, listener);
    return () => ipcRenderer.off(NEW_SALE_CHANNEL, listener);
  },
  window: {
    minimize: () => ipcRenderer.send(WINDOW_MINIMIZE_CHANNEL),
    toggleMaximize: () => ipcRenderer.send(WINDOW_TOGGLE_MAXIMIZE_CHANNEL),
    close: () => ipcRenderer.send(WINDOW_CLOSE_CHANNEL),
    isMaximized: () => windowMaximized.current() ?? false,
    onMaximizedChange: (listener) => windowMaximized.subscribe(() => listener()),
  },
};

contextBridge.exposeInMainWorld("desktopShell", desktopShell);

if (import.meta.env.PROD) {
  const updater: AppUpdaterBridge = {
    check: () => ipcRenderer.invoke(UPDATER_CHECK_CHANNEL),
    download: () => ipcRenderer.invoke(UPDATER_DOWNLOAD_CHANNEL),
    install() {
      ipcRenderer.send(UPDATER_INSTALL_CHANNEL);
    },
    onEvent(callback) {
      const listener = (_event: Electron.IpcRendererEvent, updaterEvent: UpdaterEvent) =>
        callback(updaterEvent);
      ipcRenderer.on(UPDATER_EVENT_CHANNEL, listener);
      return () => ipcRenderer.off(UPDATER_EVENT_CHANNEL, listener);
    },
  };

  contextBridge.exposeInMainWorld("updater", updater);
}
