import * as Effect from "effect/Effect";
import { app, ipcMain, type BrowserWindow } from "electron";
import electronUpdater from "electron-updater";

import {
  makeUpdaterWorkflow,
  type UpdaterProvider,
  type UpdaterProviderEvent,
} from "./updater-workflow";

const { autoUpdater } = electronUpdater;

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const MIN_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const RETRY_CHECK_DELAY_MS = 30_000;
const INITIAL_CHECK_DELAY_MS = 5_000;
const PROGRESS_EVENT_INTERVAL_MS = 250;

const providerError = (cause: unknown) =>
  cause instanceof Error ? cause : new Error(String(cause));

const subscribe = (listener: (event: UpdaterProviderEvent) => void) => {
  let lastProgressAt = 0;
  let lastProgress = -1;
  const checking = () => listener({ type: "checking" });
  const available = (info: { version: string }) =>
    listener({ type: "available", version: info.version });
  const notAvailable = () => listener({ type: "not-available" });
  const progress = (info: { percent: number }) => {
    const percent = Math.min(100, Math.max(0, Math.round(info.percent)));
    const now = Date.now();
    if (
      percent === lastProgress ||
      (percent < 100 && now - lastProgressAt < PROGRESS_EVENT_INTERVAL_MS)
    )
      return;
    lastProgress = percent;
    lastProgressAt = now;
    listener({ type: "progress", percent });
  };
  const downloaded = (info: { version: string }) =>
    listener({ type: "downloaded", version: info.version });
  const error = (cause: Error) => listener({ type: "error", error: cause });

  autoUpdater.on("checking-for-update", checking);
  autoUpdater.on("update-available", available);
  autoUpdater.on("update-not-available", notAvailable);
  autoUpdater.on("download-progress", progress);
  autoUpdater.on("update-downloaded", downloaded);
  autoUpdater.on("error", error);

  return () => {
    autoUpdater.off("checking-for-update", checking);
    autoUpdater.off("update-available", available);
    autoUpdater.off("update-not-available", notAvailable);
    autoUpdater.off("download-progress", progress);
    autoUpdater.off("update-downloaded", downloaded);
    autoUpdater.off("error", error);
  };
};

export async function setupUpdater(getWindow: () => BrowserWindow | null) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  const provider: UpdaterProvider = {
    checkForUpdates: Effect.tryPromise({
      try: () => autoUpdater.checkForUpdates().then(() => undefined),
      catch: providerError,
    }),
    downloadUpdate: Effect.tryPromise({
      try: () => autoUpdater.downloadUpdate().then(() => undefined),
      catch: providerError,
    }),
    quitAndInstall: () => autoUpdater.quitAndInstall(),
    subscribe,
  };
  const workflow = await Effect.runPromise(
    makeUpdaterWorkflow(
      provider,
      (event) => getWindow()?.webContents.send("updater:event", event),
      {
        checkInterval: CHECK_INTERVAL_MS,
        initialCheckDelay: INITIAL_CHECK_DELAY_MS,
        minimumCheckInterval: MIN_CHECK_INTERVAL_MS,
        pendingReleaseRetryDelay: RETRY_CHECK_DELAY_MS,
        periodicChecks: app.isPackaged,
      },
    ),
  );

  ipcMain.handle("updater:check", () => Effect.runPromise(workflow.check()));
  ipcMain.handle("updater:download", () => Effect.runPromise(workflow.download));
  const install = () => {
    Effect.runSync(workflow.install);
  };
  ipcMain.on("updater:install", install);

  return async () => {
    ipcMain.removeHandler("updater:check");
    ipcMain.removeHandler("updater:download");
    ipcMain.off("updater:install", install);
    await Effect.runPromise(workflow.dispose);
  };
}
