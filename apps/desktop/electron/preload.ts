import { ipcRenderer, contextBridge } from "electron";
import type { OfflineStoreApi } from "@store/contracts";

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args;
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args));
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args;
    return ipcRenderer.off(channel, ...omit);
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args;
    return ipcRenderer.send(channel, ...omit);
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args;
    return ipcRenderer.invoke(channel, ...omit);
  },

  // You can expose other APTs you need here.
  // ...
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

const offlineStore: OfflineStoreApi = {
  listCategories: () => ipcRenderer.invoke("store:categories:list"),
  listProducts: () => ipcRenderer.invoke("store:products:list"),
  getProduct: (input) => ipcRenderer.invoke("store:products:get", input),
  createProduct: (input) => ipcRenderer.invoke("store:products:create", input),
  updateProduct: (input) => ipcRenderer.invoke("store:products:update", input),
  deleteProduct: (input) => ipcRenderer.invoke("store:products:delete", input),
  getSyncStatus: () => ipcRenderer.invoke("store:sync:status"),
  sync: () => ipcRenderer.invoke("store:sync:run"),
};

contextBridge.exposeInMainWorld("offlineStore", offlineStore);
