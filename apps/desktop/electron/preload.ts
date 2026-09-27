import "@sentry/electron/preload";
import type {
  OrganizationCommand,
  OrganizationCommandResult,
  OrganizationRoster,
  TokenSet,
} from "@store/auth";
import type { InvoiceExtraction } from "@store/contracts/server-api.schema";
import type { UpdaterEvent } from "@store/contracts/updater";
import type { WorkspaceSnapshot } from "@store/contracts/workspace";
import { ipcRenderer, contextBridge } from "electron";

import { INVENTORY_HTTP_CONFIG_CHANNEL, type InventoryHttpBridge } from "./inventory-http-channels";
import { makeLastValueReplay } from "./last-value-replay";
import { NEW_SALE_CHANNEL } from "./new-sale-channels";
import {
  REPLICA_ALLOCATION_CHANNEL,
  REPLICA_CLOSE_CHANNEL,
  REPLICA_COMMIT_CHANNEL,
  REPLICA_ENQUEUE_CHANNEL,
  REPLICA_OPEN_CHANNEL,
  REPLICA_OUTBOX_CHANNEL,
  REPLICA_READ_SUBSET_CHANNEL,
  REPLICA_STAMP_CHANNEL,
  REPLICA_SYNC_HEALTH_CHANNEL,
  REPLICA_WAKE_CHANNEL,
  type ReplicaCommitEvent,
  type ReplicaIpcBridge,
  type ReplicaSyncHealthEvent,
} from "./replica-channels";

const invoke = <Result, Arguments extends ReadonlyArray<unknown> = []>(
  channel: string,
  ...args: Arguments
): Promise<Result> => ipcRenderer.invoke(channel, ...args);

const inventoryHttp: InventoryHttpBridge = {
  getConfig: () => ipcRenderer.invoke(INVENTORY_HTTP_CONFIG_CHANNEL),
};

contextBridge.exposeInMainWorld("inventoryHttp", inventoryHttp);

const syncHealthReplays = new Map<
  string,
  ReturnType<typeof makeLastValueReplay<ReplicaSyncHealthEvent["health"]>>
>();

const syncHealthReplay = (workspaceToken: string) => {
  const existing = syncHealthReplays.get(workspaceToken);
  if (existing) return existing;
  const created = makeLastValueReplay<ReplicaSyncHealthEvent["health"]>();
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
  readOutboxStatuses: (workspaceToken) =>
    ipcRenderer.invoke(REPLICA_OUTBOX_CHANNEL, workspaceToken),
  readCommandAllocation: (workspaceToken) =>
    ipcRenderer.invoke(REPLICA_ALLOCATION_CHANNEL, workspaceToken),
  enqueueLocal: (input) => ipcRenderer.invoke(REPLICA_ENQUEUE_CHANNEL, input),
  wakeSyncUpload: (workspaceToken) => ipcRenderer.invoke(REPLICA_WAKE_CHANNEL, workspaceToken),
  onCommit(callback) {
    const listener = (_event: Electron.IpcRendererEvent, event: ReplicaCommitEvent) =>
      callback(event);
    ipcRenderer.on(REPLICA_COMMIT_CHANNEL, listener);
    return () => ipcRenderer.off(REPLICA_COMMIT_CHANNEL, listener);
  },
  onSyncHealth(workspaceToken, callback) {
    const unsubscribe = syncHealthReplay(workspaceToken).subscribe(callback);
    return () => {
      unsubscribe();
    };
  },
};

contextBridge.exposeInMainWorld("replica", replica);

const sessionReplay = makeLastValueReplay<WorkspaceSnapshot>();
ipcRenderer.on("auth:session-changed", (_event, snapshot: WorkspaceSnapshot) => {
  sessionReplay.publish(snapshot);
});

contextBridge.exposeInMainWorld("auth", {
  getSession: async () => {
    const snapshot = await invoke<WorkspaceSnapshot>("auth:get-session");
    sessionReplay.publish(snapshot);
    return snapshot;
  },
  adoptSession: async (tokens: TokenSet | null) => {
    const snapshot = await invoke<WorkspaceSnapshot, [TokenSet | null]>(
      "auth:adopt-session",
      tokens,
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
    let active = true;
    let draining = false;
    let drainAgain = false;
    const drain = async () => {
      if (draining) {
        drainAgain = true;
        return;
      }
      draining = true;
      try {
        do {
          drainAgain = false;
          while (active) {
            const url = await invoke<string | null>("auth:take-oauth-callback");
            if (!url) break;
            callback(url);
          }
        } while (active && drainAgain);
      } finally {
        draining = false;
      }
    };
    const listener = () => void drain();
    ipcRenderer.on("auth:oauth-callback-available", listener);
    void drain();
    return () => {
      active = false;
      ipcRenderer.off("auth:oauth-callback-available", listener);
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
