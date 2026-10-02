import {
  classifyUpdateFailure,
  forwardsToRenderer,
  nextUpdatePhase,
  updateFailureMessage,
  type UpdaterEvent,
  type UpdatePhase,
} from "@store/contracts/updater";
import * as Clock from "effect/Clock";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberHandle from "effect/FiberHandle";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

export type UpdaterProviderEvent =
  | { readonly type: "checking" }
  | { readonly type: "available"; readonly version: string }
  | { readonly type: "not-available" }
  | { readonly type: "progress"; readonly percent: number }
  | { readonly type: "downloaded"; readonly version: string }
  | { readonly type: "error"; readonly error: Error };

export interface UpdaterProvider {
  readonly checkForUpdates: Effect.Effect<void, Error>;
  readonly downloadUpdate: Effect.Effect<void, Error>;
  readonly quitAndInstall: () => void;
  readonly events: Stream.Stream<UpdaterProviderEvent>;
}

const sameProgress = (left: UpdaterProviderEvent, right: UpdaterProviderEvent) =>
  left.type === "progress" && right.type === "progress" && left.percent === right.percent;

export const sampleDownloadProgress =
  (interval: Duration.Input) =>
  <E, R>(events: Stream.Stream<UpdaterProviderEvent, E, R>) =>
    events.pipe(
      Stream.changesWith(sameProgress),
      Stream.rechunk(1),
      Stream.throttle({
        cost: ([event]) => (event.type === "progress" && event.percent < 100 ? 1 : 0),
        units: 1,
        duration: interval,
        strategy: "enforce",
      }),
    );

interface UpdaterWorkflowConfig {
  readonly initialCheckDelay: number;
  readonly checkInterval: number;
  readonly minimumCheckInterval: number;
  readonly pendingReleaseRetryDelay: number;
  readonly periodicChecks: boolean;
}

interface UpdaterWorkflow {
  readonly check: (force?: boolean) => Effect.Effect<void>;
  readonly download: Effect.Effect<void, Error>;
  readonly install: Effect.Effect<void>;
}

interface WorkflowState {
  readonly phase: UpdatePhase;
  readonly checkInFlight: boolean;
  readonly lastCheckStartedAt: number | undefined;
}

export const makeUpdaterWorkflow = (
  provider: UpdaterProvider,
  publish: (event: UpdaterEvent) => void,
  config: UpdaterWorkflowConfig,
): Effect.Effect<UpdaterWorkflow, never, Scope.Scope> =>
  Effect.gen(function* () {
    const state = yield* Ref.make<WorkflowState>({
      phase: "idle",
      checkInFlight: false,
      lastCheckStartedAt: undefined,
    });
    const pendingReleaseRetry = yield* FiberHandle.make<void>();

    const transition = (event: UpdaterEvent, forward = true) =>
      Ref.modify(
        state,
        (current) =>
          [
            forward && forwardsToRenderer(current.phase, event),
            { ...current, phase: nextUpdatePhase(current.phase, event) },
          ] as const,
      ).pipe(
        Effect.tap((shouldPublish) =>
          shouldPublish ? Effect.sync(() => publish(event)) : Effect.void,
        ),
        Effect.asVoid,
      );

    const check = (force = false) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const claimed = yield* Ref.modify(state, (current) => {
          const throttled =
            current.lastCheckStartedAt !== undefined &&
            now - current.lastCheckStartedAt < config.minimumCheckInterval;
          if (current.phase !== "idle" || current.checkInFlight || (!force && throttled))
            return [false, current];
          return [true, { ...current, checkInFlight: true, lastCheckStartedAt: now }];
        });
        if (!claimed) return;
        yield* provider.checkForUpdates.pipe(
          Effect.ignore,
          Effect.ensuring(Ref.update(state, (current) => ({ ...current, checkInFlight: false }))),
        );
      }).pipe(Effect.withSpan("UpdaterWorkflow.check"));

    const schedulePendingReleaseRetry = FiberHandle.run(
      pendingReleaseRetry,
      Effect.sleep(config.pendingReleaseRetryDelay).pipe(Effect.andThen(check(true))),
      { onlyIfMissing: true },
    );

    const handleProviderEvent = (event: UpdaterProviderEvent) =>
      event.type === "error"
        ? Effect.gen(function* () {
            const failure = classifyUpdateFailure(event.error.message);
            const output: UpdaterEvent = {
              type: "error",
              message: updateFailureMessage(event.error.message),
              retrying: failure === "pending-release",
              failure,
            };
            yield* transition(output);
            if (failure === "pending-release") yield* schedulePendingReleaseRetry;
          })
        : transition(event);

    yield* provider.events.pipe(Stream.runForEach(handleProviderEvent), Effect.forkScoped);

    if (config.periodicChecks) {
      yield* check(true).pipe(
        Effect.repeat(Schedule.spaced(config.checkInterval)),
        Effect.delay(config.initialCheckDelay),
        Effect.forkScoped,
      );
    }

    const download = Effect.gen(function* () {
      const claimed = yield* Ref.modify(state, (current) =>
        current.phase !== "idle"
          ? ([false, current] as const)
          : ([true, { ...current, phase: "downloading" } satisfies WorkflowState] as const),
      );
      if (!claimed) return;
      yield* provider.downloadUpdate.pipe(
        Effect.tapError(() =>
          Ref.update(
            state,
            (current) =>
              ({
                ...current,
                phase: "idle",
              }) satisfies WorkflowState,
          ),
        ),
      );
    }).pipe(Effect.withSpan("UpdaterWorkflow.download"));

    return {
      check,
      download,
      install: Effect.sync(() => provider.quitAndInstall()),
    };
  });
