import { homedir } from "node:os";

import {
  classifyUpdateFailure,
  forwardsToRenderer,
  nextUpdatePhase,
  updateFailureMessage,
  type UpdaterEvent,
  type UpdatePhase,
} from "@store/contracts/updater";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FiberHandle from "effect/FiberHandle";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { app } from "electron";
import electronUpdater from "electron-updater";

import { ShellEvents } from "./shell-events";

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

class UpdaterCheckFailed extends Schema.TaggedError<UpdaterCheckFailed>()("UpdaterCheckFailed", {
  cause: Schema.Defect(),
}) {}

const decodePendingUpdateInfo = Schema.decodeUnknownOption(
  Schema.fromJsonString(PendingUpdateInfo),
);

const versionFromPendingFileName = (fileName: string) => {
  const match = /(?:^|-)(\d+\.\d+\.\d+)(?:\.AppImage)?$/u.exec(fileName);
  return match?.[1];
};

const updaterCacheRoot = (path: Path.Path) =>
  process.env["XDG_CACHE_HOME"] || path.join(homedir(), ".cache");

const clearStalePendingUpdate = Effect.fn("Updater.clearStalePendingUpdate")(
  function* (currentVersion: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const pendingDirectory = path.join(updaterCacheRoot(path), "@storedesktop-updater", "pending");
    const text = yield* fs.readFileString(path.join(pendingDirectory, "update-info.json"));
    const info = decodePendingUpdateInfo(text);
    if (Option.isNone(info) || !info.value.fileName) return;
    const pendingVersion = versionFromPendingFileName(info.value.fileName);
    if (!pendingVersion) return;
    const pendingIsNewerThanCurrent =
      pendingVersion.localeCompare(currentVersion, undefined, {
        numeric: true,
        sensitivity: "base",
      }) > 0;
    if (!pendingIsNewerThanCurrent) {
      yield* fs.remove(pendingDirectory, { force: true, recursive: true });
    }
  },
  (effect) => Effect.ignore(effect),
);

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
    error: (cause: Error) => emit({ type: "error", error: cause }),
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
  catch: (cause) => new UpdaterCheckFailed({ cause }),
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
            yield* Effect.logError("updater.failed", event.error);
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

    yield* clearStalePendingUpdate(app.getVersion()).pipe(
      Effect.andThen(check.pipe(Effect.repeat(Schedule.spaced(CHECK_INTERVAL_MS)))),
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

export class Updater extends Context.Service<
  Updater,
  {
    readonly checkNow: Effect.Effect<void>;
    readonly install: Effect.Effect<void>;
  }
>()("@store/desktop/Updater") {
  static readonly layerUnpackaged = Layer.succeed(
    Updater,
    Updater.of({ checkNow: Effect.void, install: Effect.void }),
  );

  static readonly layer = Layer.effect(
    Updater,
    Effect.gen(function* () {
      const events = yield* ShellEvents;
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.logger = console;
      autoUpdater.setFeedURL({
        provider: "github",
        owner: "zohaibakber",
        repo: "store",
      });
      const workflow = yield* makeUpdaterWorkflow((event) => {
        PubSub.publishUnsafe(events.updater, event);
      });
      return Updater.of({
        checkNow: workflow.checkNow,
        install: Effect.sync(() => autoUpdater.quitAndInstall()),
      });
    }),
  );
}
