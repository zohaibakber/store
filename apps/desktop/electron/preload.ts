import type { InvoiceExtraction, OfflineStoreApi } from "@store/contracts";
import type { UpdaterEvent } from "@store/contracts/updater";
import { ipcRenderer, contextBridge } from "electron";

import type { AuthSnapshot } from "./auth";
import { STORE_CHANNELS, STORE_SYNC_STATUS_CHANNEL } from "./store-channels";

contextBridge.exposeInMainWorld("auth", {
  getSession: () => ipcRenderer.invoke("auth:get-session") as Promise<AuthSnapshot>,
  signIn: (input: { email: string; password: string }) =>
    ipcRenderer.invoke("auth:sign-in", input) as Promise<AuthSnapshot>,
  signUp: (input: { name: string; email: string; password: string }) =>
    ipcRenderer.invoke("auth:sign-up", input) as Promise<AuthSnapshot>,
  signOut: () => ipcRenderer.invoke("auth:sign-out") as Promise<void>,
  switchOrganization: (input: { organizationId: string }) =>
    ipcRenderer.invoke("auth:organization:switch", input) as Promise<AuthSnapshot>,
  createOrganization: (input: { name: string }) =>
    ipcRenderer.invoke("auth:organization:create", input) as Promise<AuthSnapshot>,
  onSessionChange(callback: (snapshot: AuthSnapshot) => void) {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: AuthSnapshot) =>
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

contextBridge.exposeInMainWorld("windowControls", {
  minimize() {
    ipcRenderer.send("window-controls:minimize");
  },
  toggleMaximize() {
    return ipcRenderer.invoke("window-controls:toggle-maximize") as Promise<boolean>;
  },
  isMaximized() {
    return ipcRenderer.invoke("window-controls:is-maximized") as Promise<boolean>;
  },
  isFullScreen() {
    return ipcRenderer.invoke("window-controls:is-full-screen") as Promise<boolean>;
  },
  onFullScreenChange(callback: (isFullScreen: boolean) => void) {
    const listener = (_event: Electron.IpcRendererEvent, isFullScreen: boolean) => {
      callback(isFullScreen);
    };
    ipcRenderer.on("window-controls:full-screen-changed", listener);

    return () => ipcRenderer.off("window-controls:full-screen-changed", listener);
  },
  close() {
    ipcRenderer.send("window-controls:close");
  },
});

contextBridge.exposeInMainWorld("updater", {
  check: () => ipcRenderer.invoke("updater:check") as Promise<void>,
  download: () => ipcRenderer.invoke("updater:download") as Promise<void>,
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

type StoreIpcResult<A> =
  | { readonly ok: true; readonly value: A }
  | {
      readonly ok: false;
      readonly error: unknown;
    };

const invokeStore = async <A>(channel: string, input?: unknown): Promise<A> => {
  const result: StoreIpcResult<A> = await ipcRenderer.invoke(channel, input);
  if (result.ok) return result.value;
  throw result.error;
};

const requestMethods = Object.fromEntries(
  Object.entries(STORE_CHANNELS).map(([method, channel]) => [
    method,
    (input?: unknown) => invokeStore(channel, input),
  ]),
) as Omit<OfflineStoreApi, "onSyncStatusChange">;

const offlineStore: OfflineStoreApi = {
  ...requestMethods,
  onSyncStatusChange(callback) {
    const listener = (_event: Electron.IpcRendererEvent, status: Parameters<typeof callback>[0]) =>
      callback(status);
    ipcRenderer.on(STORE_SYNC_STATUS_CHANNEL, listener);
    return () => ipcRenderer.off(STORE_SYNC_STATUS_CHANNEL, listener);
  },
};

contextBridge.exposeInMainWorld("offlineStore", offlineStore);
