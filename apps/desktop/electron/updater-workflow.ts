import {
  classifyUpdateFailure,
  forwardsToRenderer,
  nextUpdatePhase,
  updateFailureMessage,
  type UpdaterEvent,
  type UpdatePhase,
} from "@store/contracts/updater";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";

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
  readonly subscribe: (listener: (event: UpdaterProviderEvent) => void) => () => void;
}

export interface UpdaterWorkflowConfig {
  readonly initialCheckDelay: number;
  readonly checkInterval: number;
  readonly minimumCheckInterval: number;
  readonly pendingReleaseRetryDelay: number;
  readonly periodicChecks: boolean;
}

export interface UpdaterWorkflow {
  readonly check: (force?: boolean) => Effect.Effect<void>;
  readonly download: Effect.Effect<void, Error>;
  readonly install: Effect.Effect<void>;
  readonly dispose: Effect.Effect<void>;
}

interface WorkflowState {
  readonly phase: UpdatePhase;
  readonly checkInFlight: boolean;
  readonly lastCheckStartedAt: number | undefined;
  readonly stopped: boolean;
}

export const makeUpdaterWorkflow = (
  provider: UpdaterProvider,
  publish: (event: UpdaterEvent) => void,
  config: UpdaterWorkflowConfig,
): Effect.Effect<UpdaterWorkflow> =>
  Effect.gen(function* () {
    const state = yield* Ref.make<WorkflowState>({
      phase: "idle",
      checkInFlight: false,
      lastCheckStartedAt: undefined,
      stopped: false,
    });
    const retryFiber = yield* Ref.make<Fiber.Fiber<unknown, unknown> | undefined>(undefined);
    const periodicFiber = yield* Ref.make<Fiber.Fiber<unknown, unknown> | undefined>(undefined);
    const context = yield* Effect.context<never>();

    const transition = (event: UpdaterEvent, forward = true) =>
      Ref.modify(state, (current) => [
        forward && forwardsToRenderer(current.phase, event),
        { ...current, phase: nextUpdatePhase(current.phase, event) },
      ]).pipe(
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
          if (
            current.stopped ||
            current.phase !== "idle" ||
            current.checkInFlight ||
            (!force && throttled)
          )
            return [false, current];
          return [true, { ...current, checkInFlight: true, lastCheckStartedAt: now }];
        });
        if (!claimed) return;
        yield* provider.checkForUpdates.pipe(
          Effect.ignore,
          Effect.ensuring(Ref.update(state, (current) => ({ ...current, checkInFlight: false }))),
        );
      }).pipe(Effect.withSpan("UpdaterWorkflow.check"));

    const schedulePendingReleaseRetry = Ref.get(retryFiber).pipe(
      Effect.flatMap((current) => {
        if (current) return Effect.void;
        return Effect.sleep(config.pendingReleaseRetryDelay).pipe(
          Effect.andThen(check(true)),
          Effect.ensuring(Ref.set(retryFiber, undefined)),
          Effect.forkDetach({ startImmediately: true }),
          Effect.flatMap((fiber) => Ref.set(retryFiber, fiber)),
        );
      }),
    );

    const handleProviderEvent = (event: UpdaterProviderEvent) =>
      event.type === "error"
        ? Effect.gen(function* () {
            const failure = classifyUpdateFailure(event.error.message);
            const output: UpdaterEvent = {
              type: "error",
              message: updateFailureMessage(event.error.message),
              retrying: failure === "pending-release",
            };
            yield* transition(output, failure !== "network");
            if (failure === "pending-release") yield* schedulePendingReleaseRetry;
          })
        : transition(event);

    const unsubscribe = provider.subscribe((event) => {
      Effect.runForkWith(context)(handleProviderEvent(event));
    });

    if (config.periodicChecks) {
      const fiber = yield* check(true).pipe(
        Effect.repeat(Schedule.spaced(config.checkInterval)),
        Effect.delay(config.initialCheckDelay),
        Effect.forkDetach({ startImmediately: true }),
      );
      yield* Ref.set(periodicFiber, fiber);
    }

    const download = Effect.gen(function* () {
      const claimed = yield* Ref.modify(state, (current) =>
        current.stopped || current.phase !== "idle"
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

    const dispose = Ref.modify(state, (current) => [
      !current.stopped,
      { ...current, stopped: true },
    ]).pipe(
      Effect.flatMap((shouldDispose) => {
        if (!shouldDispose) return Effect.void;
        return Effect.gen(function* () {
          unsubscribe();
          const retry = yield* Ref.get(retryFiber);
          const periodic = yield* Ref.get(periodicFiber);
          if (retry) yield* Fiber.interrupt(retry);
          if (periodic) yield* Fiber.interrupt(periodic);
        });
      }),
    );

    return {
      check,
      download,
      install: Effect.sync(() => provider.quitAndInstall()),
      dispose,
    };
  });
