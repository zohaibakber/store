import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { app, ipcMain, type BrowserWindow, type IpcMainEvent } from "electron";
import electronUpdater from "electron-updater";

import { assertTrustedIpcSender } from "./ipc-sender";
import {
  makeUpdaterWorkflow,
  sampleDownloadProgress,
  type UpdaterProvider,
  type UpdaterProviderEvent,
} from "./updater-workflow";

const { autoUpdater } = electronUpdater;

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const MIN_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const RETRY_CHECK_DELAY_MS = 30_000;
const INITIAL_CHECK_DELAY_MS = 5_000;
const PROGRESS_EVENT_INTERVAL = "250 millis";

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

const clearStalePendingUpdate = async (currentVersion: string) => {
  const pendingDirectory = path.join(updaterCacheRoot(), "@storedesktop-updater", "pending");
  try {
    const info = Schema.decodeUnknownSync(Schema.fromJsonString(PendingUpdateInfo))(
      await readFile(path.join(pendingDirectory, "update-info.json"), "utf8"),
    );
    const pendingVersion = info.fileName ? versionFromPendingFileName(info.fileName) : undefined;
    if (!pendingVersion) return;
    const pendingIsNewerThanCurrent =
      pendingVersion.localeCompare(currentVersion, undefined, {
        numeric: true,
        sensitivity: "base",
      }) > 0;
    if (!pendingIsNewerThanCurrent) await rm(pendingDirectory, { force: true, recursive: true });
  } catch {}
};

const clampPercent = (percent: number) => Math.min(100, Math.max(0, Math.round(percent)));

const updaterEvents = Stream.callback<UpdaterProviderEvent>((queue) => {
  const emit = (event: UpdaterProviderEvent) => {
    Queue.offerUnsafe(queue, event);
  };
  const listeners = {
    "checking-for-update": () => emit({ type: "checking" }),
    "update-available": (info: { version: string }) =>
      emit({ type: "available", version: info.version }),
    "update-not-available": () => emit({ type: "not-available" }),
    "download-progress": (info: { percent: number }) =>
      emit({ type: "progress", percent: clampPercent(info.percent) }),
    "update-downloaded": (info: { version: string }) =>
      emit({ type: "downloaded", version: info.version }),
    error: (cause: Error) => {
      console.error("There was a problem updating the application");
      console.error(cause);
      emit({ type: "error", error: cause });
    },
  };
  return Effect.acquireRelease(
    Effect.sync(() => {
      autoUpdater.on("checking-for-update", listeners["checking-for-update"]);
      autoUpdater.on("update-available", listeners["update-available"]);
      autoUpdater.on("update-not-available", listeners["update-not-available"]);
      autoUpdater.on("download-progress", listeners["download-progress"]);
      autoUpdater.on("update-downloaded", listeners["update-downloaded"]);
      autoUpdater.on("error", listeners.error);
    }),
    () =>
      Effect.sync(() => {
        autoUpdater.off("checking-for-update", listeners["checking-for-update"]);
        autoUpdater.off("update-available", listeners["update-available"]);
        autoUpdater.off("update-not-available", listeners["update-not-available"]);
        autoUpdater.off("download-progress", listeners["download-progress"]);
        autoUpdater.off("update-downloaded", listeners["update-downloaded"]);
        autoUpdater.off("error", listeners.error);
      }),
  );
}).pipe(sampleDownloadProgress(PROGRESS_EVENT_INTERVAL));

const subscribe = (listener: (event: UpdaterProviderEvent) => void) => {
  const fiber = Effect.runFork(
    Stream.runForEach(updaterEvents, (event) => Effect.sync(() => listener(event))),
  );
  return () => {
    Effect.runFork(Fiber.interrupt(fiber));
  };
};

export async function setupUpdater(
  getWindow: () => BrowserWindow | null,
  allowedOrigins: () => ReadonlyArray<string>,
) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;
  if (__UPDATE_CHANNEL__ !== "latest") autoUpdater.channel = __UPDATE_CHANNEL__;
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

  const skipCheckThrottle = true;
  ipcMain.handle("updater:check", (event) => {
    assertTrustedIpcSender(event.senderFrame, allowedOrigins());
    return Effect.runPromise(workflow.check(skipCheckThrottle));
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
