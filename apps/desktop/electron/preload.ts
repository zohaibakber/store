import { ipcRenderer, contextBridge } from "electron";
import type { OfflineStoreApi } from "@store/contracts";
import type { AuthSnapshot } from "./auth";
import type { UpdaterEvent } from "./updater";

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
  getModels: () => ipcRenderer.invoke("server:models"),
  analyseInvoices: (input: {
    model: string;
    files: Array<{ name: string; type: string; bytes: ArrayBuffer }>;
  }) => ipcRenderer.invoke("server:uploads", input),
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
  getVersion: () => ipcRenderer.invoke("updater:version") as Promise<string>,
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

const offlineStore: OfflineStoreApi = {
  listCategories: () => ipcRenderer.invoke("store:categories:list"),
  listProducts: () => ipcRenderer.invoke("store:products:list"),
  searchProducts: (input) => ipcRenderer.invoke("store:products:search", input),
  getProduct: (input) => ipcRenderer.invoke("store:products:get", input),
  createProduct: (input) => ipcRenderer.invoke("store:products:create", input),
  updateProduct: (input) => ipcRenderer.invoke("store:products:update", input),
  deleteProduct: (input) => ipcRenderer.invoke("store:products:delete", input),
  createBatch: (input) => ipcRenderer.invoke("store:batches:create", input),
  listStockMovements: (input) => ipcRenderer.invoke("store:stock-movements:list", input),
  listInvoices: () => ipcRenderer.invoke("store:invoices:list"),
  getInvoice: (input) => ipcRenderer.invoke("store:invoices:get", input),
  createInvoice: (input) => ipcRenderer.invoke("store:invoices:create", input),
  getSyncStatus: () => ipcRenderer.invoke("store:sync:status"),
  sync: () => ipcRenderer.invoke("store:sync:run"),
};

contextBridge.exposeInMainWorld("offlineStore", offlineStore);
