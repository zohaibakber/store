import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  classifyUpdateFailure,
  forwardsToRenderer,
  nextUpdatePhase,
  updateFailureMessage,
  type UpdaterEvent,
  type UpdatePhase,
} from "@store/contracts/updater";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FiberHandle from "effect/FiberHandle";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { app, ipcMain, type BrowserWindow, type IpcMainEvent } from "electron";
import electronUpdater from "electron-updater";

import {
  UPDATER_CHECK_CHANNEL,
  UPDATER_EVENT_CHANNEL,
  UPDATER_INSTALL_CHANNEL,
} from "./ipc-channels";
import { isTrustedIpcSenderFrame, trustedIpcListener } from "./ipc-sender";

const { autoUpdater } = electronUpdater;

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const RETRY_CHECK_DELAY_MS = 30_000;
const INITIAL_CHECK_DELAY_MS = 5_000;
const PROGRESS_EVENT_INTERVAL = "250 millis";

type AutoUpdaterEvent =
  | { readonly type: "checking" }
  | { readonly type: "available"; readonly version: string }
  | { readonly type: "not-available" }
  | { readonly type: "progress"; readonly percent: number }
  | { readonly type: "downloaded"; readonly version: string }
  | { readonly type: "error"; readonly error: Error };

interface WorkflowState {
  readonly phase: UpdatePhase;
  readonly checkInFlight: boolean;
  readonly version: string | null;
}

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

const sameProgress = (left: AutoUpdaterEvent, right: AutoUpdaterEvent) =>
  left.type === "progress" && right.type === "progress" && left.percent === right.percent;

const updaterEvents = Stream.callback<AutoUpdaterEvent>((queue) => {
  const emit = (event: AutoUpdaterEvent) => {
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
}).pipe(
  Stream.changesWith(sameProgress),
  Stream.rechunk(1),
  Stream.throttle({
    cost: ([event]) => (event.type === "progress" && event.percent < 100 ? 1 : 0),
    units: 1,
    duration: PROGRESS_EVENT_INTERVAL,
    strategy: "enforce",
  }),
);

const checkForUpdates = Effect.tryPromise({
  try: () => autoUpdater.checkForUpdates().then(() => undefined),
  catch: providerError,
});

const makeUpdaterWorkflow = (publish: (event: UpdaterEvent) => void) =>
  Effect.gen(function* () {
    const state = yield* Ref.make<WorkflowState>({
      phase: "idle",
      checkInFlight: false,
      version: null,
    });
    const pendingReleaseRetry = yield* FiberHandle.make<void>();

    const transition = (event: UpdaterEvent) =>
      Ref.modify(
        state,
        (current) =>
          [
            forwardsToRenderer(current.phase, event),
            {
              ...current,
              phase: nextUpdatePhase(current.phase, event),
              version:
                event.type === "available" || event.type === "downloaded"
                  ? event.version
                  : current.version,
            },
          ] as const,
      ).pipe(
        Effect.tap((shouldPublish) =>
          shouldPublish ? Effect.sync(() => publish(event)) : Effect.void,
        ),
        Effect.asVoid,
      );

    const check = Effect.gen(function* () {
      const claimed = yield* Ref.modify(state, (current) =>
        current.phase !== "idle" || current.checkInFlight
          ? ([false, current] as const)
          : ([true, { ...current, checkInFlight: true }] as const),
      );
      if (!claimed) return;
      yield* checkForUpdates.pipe(
        Effect.ignore,
        Effect.ensuring(Ref.update(state, (current) => ({ ...current, checkInFlight: false }))),
      );
    }).pipe(Effect.withSpan("UpdaterWorkflow.check"));

    const schedulePendingReleaseRetry = FiberHandle.run(
      pendingReleaseRetry,
      Effect.sleep(RETRY_CHECK_DELAY_MS).pipe(Effect.andThen(check)),
      { onlyIfMissing: true },
    );

    const handleUpdaterEvent = (event: AutoUpdaterEvent) =>
      event.type === "error"
        ? Effect.gen(function* () {
            const failure = classifyUpdateFailure(event.error.message);
            yield* transition({
              type: "error",
              message: updateFailureMessage(event.error.message),
              retrying: failure === "pending-release",
              failure,
            });
            if (failure === "pending-release") yield* schedulePendingReleaseRetry;
          })
        : transition(event);

    yield* updaterEvents.pipe(Stream.runForEach(handleUpdaterEvent), Effect.forkScoped);

    yield* check.pipe(
      Effect.repeat(Schedule.spaced(CHECK_INTERVAL_MS)),
      Effect.delay(INITIAL_CHECK_DELAY_MS),
      Effect.forkScoped,
    );

    const checkNow = Effect.gen(function* () {
      const { phase, version } = yield* Ref.get(state);
      if (phase === "idle" || version === null) return yield* check;
      publish(
        phase === "downloaded" ? { type: "downloaded", version } : { type: "available", version },
      );
    }).pipe(Effect.withSpan("UpdaterWorkflow.checkNow"));

    return { checkNow };
  });

export async function setupUpdater(
  getWindow: () => BrowserWindow | null,
  allowedOrigins: () => ReadonlyArray<string>,
) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;
  autoUpdater.setFeedURL({
    provider: "github",
    owner: "zohaibakber",
    repo: "store",
  });
  await clearStalePendingUpdate(app.getVersion());

  const scope = Scope.makeUnsafe();
  const workflow = await Effect.runPromise(
    makeUpdaterWorkflow((event) =>
      getWindow()?.webContents.send(UPDATER_EVENT_CHANNEL, event),
    ).pipe(Scope.provide(scope)),
  );

  ipcMain.handle(
    UPDATER_CHECK_CHANNEL,
    trustedIpcListener(allowedOrigins, () => Effect.runPromise(workflow.checkNow)),
  );
  const install = (event: IpcMainEvent) => {
    if (!isTrustedIpcSenderFrame(event.senderFrame, allowedOrigins())) return;
    autoUpdater.quitAndInstall();
  };
  ipcMain.on(UPDATER_INSTALL_CHANNEL, install);

  return async () => {
    ipcMain.removeHandler(UPDATER_CHECK_CHANNEL);
    ipcMain.off(UPDATER_INSTALL_CHANNEL, install);
    await Effect.runPromise(Scope.close(scope, Exit.void));
  };
}
