import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { app, ipcMain, type BrowserWindow, type IpcMainEvent } from "electron";
import electronUpdater from "electron-updater";

import { assertTrustedIpcSender } from "./ipc-sender";
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

const PendingUpdateInfo = Schema.Struct({
  fileName: Schema.optional(Schema.String),
});

const providerError = (cause: unknown) =>
  cause instanceof Error ? cause : new Error(String(cause));

const versionFromPendingFileName = (fileName: string) => {
  const match = /(?:^|-)(\d+\.\d+\.\d+)(?:\.AppImage)?$/u.exec(fileName);
  return match?.[1];
};

const updaterCacheRoot = () => process.env["XDG_CACHE_HOME"] || path.join(homedir(), ".cache");

/** Remove pending packages that are not newer than the running build. */
export const clearStalePendingUpdate = async (currentVersion: string) => {
  const pendingDirectory = path.join(updaterCacheRoot(), "@storedesktop-updater", "pending");
  try {
    const info = Schema.decodeUnknownSync(PendingUpdateInfo)(
      JSON.parse(await readFile(path.join(pendingDirectory, "update-info.json"), "utf8")),
    );
    const pendingVersion = info.fileName ? versionFromPendingFileName(info.fileName) : undefined;
    if (!pendingVersion) return;
    // Equal or older leftovers make the next launch report no update even after
    // GitHub has published a newer build.
    const newer =
      pendingVersion.localeCompare(currentVersion, undefined, {
        numeric: true,
        sensitivity: "base",
      }) > 0;
    if (!newer) await rm(pendingDirectory, { force: true, recursive: true });
  } catch {
    // Missing cache is the common case.
  }
};

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

export async function setupUpdater(
  getWindow: () => BrowserWindow | null,
  allowedOrigins: () => ReadonlyArray<string>,
) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.setFeedURL({
    provider: "github",
    owner: "zohaibakber",
    repo: "store",
  });
  await clearStalePendingUpdate(app.getVersion());

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

  // Manual "Check for updates" and focus checks must skip the throttle, or a
  // stale not-available right after publish sticks for minutes.
  ipcMain.handle("updater:check", (event) => {
    assertTrustedIpcSender(event.senderFrame, allowedOrigins());
    return Effect.runPromise(workflow.check(true));
  });
  ipcMain.handle("updater:download", (event) => {
    assertTrustedIpcSender(event.senderFrame, allowedOrigins());
    return Effect.runPromise(workflow.download);
  });
  const install = (event: IpcMainEvent) => {
    assertTrustedIpcSender(event.senderFrame, allowedOrigins());
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
