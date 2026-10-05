import "@sentry/electron/preload";
import { REPLICA_PORTS_CHANNEL, type ReplicaPortsMessage } from "@store/contracts/replica";
import type { UpdaterEvent } from "@store/contracts/updater";
import type {
  InventoryHttpBridge,
  ReplicaWorkspaceBridge,
  ServerApiIpcBridge,
} from "@store/web/host/electron";
import type { AppUpdaterBridge, DesktopShellBridge, ThemeBridge } from "@store/web/host/index";
import { makeReplayChannel } from "@store/web/host/replay-channel";
import type { ShareBridge } from "@store/web/host/share";
import type { WorkspaceBackupBridge } from "@store/web/host/workspace-backup";
import { ipcRenderer, contextBridge } from "electron";

import {
  BACKUP_SAVE_CHANNEL,
  INVENTORY_HTTP_CONFIG_CHANNEL,
  NEW_SALE_CHANNEL,
  REPLICA_CLOSE_CHANNEL,
  REPLICA_OPEN_CHANNEL,
  REPLICA_RETRY_CHANNEL,
  RESTORE_APPLY_CHANNEL,
  RESTORE_CHOOSE_CHANNEL,
  RESTORE_DISCARD_CHANNEL,
  SERVER_GLOBAL_SEARCH_CHANNEL,
  SERVER_UPLOADS_CHANNEL,
  SHARE_COPY_TEXT_CHANNEL,
  SHARE_OPEN_EXTERNAL_CHANNEL,
  SHARE_PRINT_CHANNEL,
  SHARE_SAVE_PDF_CHANNEL,
  THEME_SET_SOURCE_CHANNEL,
  UPDATER_CHECK_CHANNEL,
  UPDATER_EVENT_CHANNEL,
  UPDATER_INSTALL_CHANNEL,
  WINDOW_CLOSE_CHANNEL,
  WINDOW_MAXIMIZED_CHANNEL,
  WINDOW_MINIMIZE_CHANNEL,
  WINDOW_TOGGLE_MAXIMIZE_CHANNEL,
} from "./ipc-channels";

ipcRenderer.on(REPLICA_PORTS_CHANNEL, (event, message: ReplicaPortsMessage) => {
  window.postMessage(message, "*", event.ports);
});

const inventoryHttp: InventoryHttpBridge = {
  getConfig: () => ipcRenderer.invoke(INVENTORY_HTTP_CONFIG_CHANNEL),
};

contextBridge.exposeInMainWorld("inventoryHttp", inventoryHttp);

const replica: ReplicaWorkspaceBridge = {
  open: () => ipcRenderer.invoke(REPLICA_OPEN_CHANNEL),
  close: (workspaceToken) => ipcRenderer.invoke(REPLICA_CLOSE_CHANNEL, workspaceToken),
  retryRecovery: (workspaceToken) => ipcRenderer.invoke(REPLICA_RETRY_CHANNEL, workspaceToken),
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

const serverApi: ServerApiIpcBridge = {
  analyseInvoices: (input) => ipcRenderer.invoke(SERVER_UPLOADS_CHANNEL, input),
  searchGlobalProducts: (input) => ipcRenderer.invoke(SERVER_GLOBAL_SEARCH_CHANNEL, input),
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
