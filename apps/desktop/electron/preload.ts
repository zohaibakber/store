import type {
  OrganizationCommand,
  OrganizationCommandResult,
  OrganizationRoster,
  TokenSet,
} from "@store/auth";
import type { InvoiceExtraction, OfflineStoreApi, WorkspaceSnapshot } from "@store/contracts";
import type { UpdaterEvent } from "@store/contracts/updater";
import { ipcRenderer, contextBridge } from "electron";

import { STORE_CHANNELS, STORE_SYNC_STATUS_CHANNEL } from "./store-channels";

const invoke = <Result, Arguments extends ReadonlyArray<unknown> = []>(
  channel: string,
  ...args: Arguments
): Promise<Result> => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("auth", {
  getSession: () => invoke<WorkspaceSnapshot>("auth:get-session"),
  adoptSession: (tokens: TokenSet | null) =>
    invoke<WorkspaceSnapshot, [TokenSet | null]>("auth:adopt-session", tokens),
  renewSession: () => invoke<WorkspaceSnapshot>("auth:renew-session"),
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
    const listener = (_event: Electron.IpcRendererEvent, snapshot: WorkspaceSnapshot) =>
      callback(snapshot);
    ipcRenderer.on("auth:session-changed", listener);
    return () => ipcRenderer.off("auth:session-changed", listener);
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

type StoreIpcResult<A> =
  | { readonly ok: true; readonly value: A }
  | {
      readonly ok: false;
      readonly error: unknown;
    };

const invokeStore = async <A, Input>(channel: string, input?: Input): Promise<A> => {
  const result: StoreIpcResult<A> = await ipcRenderer.invoke(channel, input);
  if (result.ok) return result.value;
  throw result.error;
};

const requestMethods = Object.fromEntries(
  Object.entries(STORE_CHANNELS).map(([method, channel]) => [
    method,
    <Input>(input?: Input) => invokeStore(channel, input),
  ]),
);
// SAFETY: STORE_CHANNELS is exhaustive for every request method in OfflineStoreApi.
const typedRequestMethods = requestMethods as Omit<OfflineStoreApi, "onSyncStatusChange">;

const offlineStore: OfflineStoreApi = {
  ...typedRequestMethods,
  onSyncStatusChange(callback) {
    const listener = (_event: Electron.IpcRendererEvent, status: Parameters<typeof callback>[0]) =>
      callback(status);
    ipcRenderer.on(STORE_SYNC_STATUS_CHANNEL, listener);
    return () => ipcRenderer.off(STORE_SYNC_STATUS_CHANNEL, listener);
  },
};

contextBridge.exposeInMainWorld("offlineStore", offlineStore);
