import {
  classifyUpdateFailure,
  forwardsToRenderer,
  nextUpdatePhase,
  updateFailureMessage,
  type UpdaterEvent,
  type UpdatePhase,
} from "@store/contracts/updater";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schedule from "effect/Schedule";
import { app, ipcMain, type BrowserWindow } from "electron";
import electronUpdater from "electron-updater";

// electron-updater is CJS; grab the instance off the default export so the
// import works from the ESM main bundle.
const { autoUpdater } = electronUpdater;

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const MIN_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const RETRY_CHECK_DELAY_MS = 30_000;
const INITIAL_CHECK_DELAY_MS = 5_000;

export function setupUpdater(getWindow: () => BrowserWindow | null) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  let phase: UpdatePhase = "idle";
  let checkInFlight = false;
  let lastCheckStartedAt = 0;
  let retryCheckTimer: ReturnType<typeof setTimeout> | undefined;

  const send = (event: UpdaterEvent) => {
    if (forwardsToRenderer(phase, event)) getWindow()?.webContents.send("updater:event", event);
    phase = nextUpdatePhase(phase, event);
  };

  const check = (force = false) => {
    const now = Date.now();
    if (
      !app.isPackaged ||
      phase !== "idle" ||
      checkInFlight ||
      (!force && now - lastCheckStartedAt < MIN_CHECK_INTERVAL_MS)
    )
      return;
    checkInFlight = true;
    lastCheckStartedAt = now;
    void autoUpdater
      .checkForUpdates()
      .catch(() => {})
      .finally(() => {
        checkInFlight = false;
      });
  };

  const scheduleRetryCheck = () => {
    if (retryCheckTimer) return;
    retryCheckTimer = setTimeout(() => {
      retryCheckTimer = undefined;
      check(true);
    }, RETRY_CHECK_DELAY_MS);
  };

  autoUpdater.on("checking-for-update", () => send({ type: "checking" }));
  autoUpdater.on("update-available", (info) => send({ type: "available", version: info.version }));
  autoUpdater.on("update-not-available", () => send({ type: "not-available" }));
  autoUpdater.on("download-progress", (progress) =>
    send({ type: "progress", percent: progress.percent }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    send({ type: "downloaded", version: info.version }),
  );
  autoUpdater.on("error", (error) => {
    console.warn("Auto-update failed", error);
    const failure = classifyUpdateFailure(error.message);

    if (failure === "network") {
      phase = nextUpdatePhase(phase, { type: "error", message: error.message, retrying: false });
      return;
    }

    const retrying = failure === "pending-release";
    send({ type: "error", message: updateFailureMessage(error.message), retrying });
    if (retrying) scheduleRetryCheck();
  });

  ipcMain.handle("updater:check", () => check());
  ipcMain.handle("updater:download", async () => {
    if (phase !== "idle") return;
    phase = "downloading";
    await autoUpdater.downloadUpdate();
  });
  ipcMain.on("updater:install", () => autoUpdater.quitAndInstall());

  if (app.isPackaged) {
    const periodicCheck = Effect.sync(check).pipe(
      Effect.delay(INITIAL_CHECK_DELAY_MS),
      Effect.repeat(Schedule.spaced(CHECK_INTERVAL_MS)),
    );
    const periodicCheckFiber = Effect.runFork(periodicCheck);
    app.once("before-quit", () => {
      Effect.runFork(Fiber.interrupt(periodicCheckFiber));
    });
  }
}
