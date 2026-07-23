import { app, ipcMain, type BrowserWindow } from "electron";
import electronUpdater from "electron-updater";

// electron-updater is CJS; grab the instance off the default export so the
// import works from the ESM main bundle.
const { autoUpdater } = electronUpdater;

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
// Give the renderer time to mount and subscribe before the first check can
// emit an `available` event.
const INITIAL_CHECK_DELAY_MS = 5_000;

export type UpdaterEvent =
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "not-available" }
  | { type: "progress"; percent: number }
  | { type: "downloaded"; version: string }
  | { type: "error"; message: string };

export function setupUpdater(getWindow: () => BrowserWindow | null) {
  const send = (event: UpdaterEvent) => getWindow()?.webContents.send("updater:event", event);

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // The periodic background check (below) can otherwise re-emit `available`
  // while a download is already running or finished, which would resurface
  // the "Download" action in the renderer mid-download.
  let downloadState: "idle" | "downloading" | "downloaded" = "idle";

  autoUpdater.on("checking-for-update", () => send({ type: "checking" }));
  autoUpdater.on("update-available", (info) => send({ type: "available", version: info.version }));
  autoUpdater.on("update-not-available", () => send({ type: "not-available" }));
  autoUpdater.on("download-progress", (progress) => {
    downloadState = "downloading";
    send({ type: "progress", percent: progress.percent });
  });
  autoUpdater.on("update-downloaded", (info) => {
    downloadState = "downloaded";
    send({ type: "downloaded", version: info.version });
  });
  autoUpdater.on("error", (error) => {
    downloadState = "idle";
    send({ type: "error", message: error.message });
  });

  const check = () => {
    if (!app.isPackaged || downloadState !== "idle") return;
    // Failures also surface through the `error` event above.
    autoUpdater.checkForUpdates().catch(() => {});
  };

  ipcMain.handle("updater:version", () => app.getVersion());
  ipcMain.handle("updater:check", () => check());
  ipcMain.handle("updater:download", async () => {
    if (downloadState !== "idle") return;
    downloadState = "downloading";
    await autoUpdater.downloadUpdate();
  });
  ipcMain.on("updater:install", () => autoUpdater.quitAndInstall());

  if (app.isPackaged) {
    setTimeout(check, INITIAL_CHECK_DELAY_MS);
    setInterval(check, CHECK_INTERVAL_MS);
  }
}
