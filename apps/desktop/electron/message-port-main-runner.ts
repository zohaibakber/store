import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import { WorkerError, WorkerReceiveError } from "effect/workers/WorkerError";
import * as WorkerRunner from "effect/workers/WorkerRunner";
import type { MessagePortMain } from "electron";

const closed = () =>
  new WorkerError({
    reason: new WorkerReceiveError({ message: "MessagePortMain closed", cause: undefined }),
  });

const make = (port: MessagePortMain): WorkerRunner.WorkerRunnerPlatform["Service"] => ({
  start: <O, I>() =>
    Effect.gen(function* () {
      const disconnects = yield* Queue.make<number>();
      const sendUnsafe = (_portId: number, message: O) => port.postMessage([1, message]);
      const send = (portId: number, message: O) => Effect.sync(() => sendUnsafe(portId, message));
      const run = <A, E, R>(
        handler: (portId: number, message: I) => Effect.Effect<A, E, R> | void,
      ): Effect.Effect<void, WorkerError, R> =>
        Effect.scopedWith(
          Effect.fnUntraced(function* (scope) {
            const closeLatch = Deferred.makeUnsafe<void, WorkerError>();
            const trackFiber = Fiber.runIn(scope);
            const services = yield* Effect.context<R>();
            const runFork = Effect.runForkWith(services);
            const onExit = (exit: Exit.Exit<unknown, unknown>) => {
              if (exit._tag === "Failure" && !Cause.hasInterruptsOnly(exit.cause)) {
                runFork(Effect.logError("MessagePortMainRunner.unhandled", exit.cause));
              }
            };
            const onMessage = (event: { readonly data: WorkerRunner.PlatformMessage<I> }) => {
              const message = event.data;
              if (message[0] === 0) {
                const result = handler(0, message[1]);
                if (Effect.isEffect(result)) {
                  const fiber = runFork(result);
                  fiber.addObserver(onExit);
                  trackFiber(fiber);
                }
              } else {
                Deferred.doneUnsafe(closeLatch, Exit.void);
              }
            };
            const onClose = () => {
              Deferred.doneUnsafe(closeLatch, Exit.fail(closed()));
            };
            port.on("message", onMessage);
            port.on("close", onClose);
            port.start();
            port.postMessage([0]);
            yield* Scope.addFinalizer(
              scope,
              Effect.sync(() => {
                port.off("message", onMessage);
                port.off("close", onClose);
                port.close();
              }),
            );
            yield* Deferred.await(closeLatch);
          }),
        );
      return { run, send, sendUnsafe, disconnects } satisfies WorkerRunner.WorkerRunner<O, I>;
    }),
});

export const layerMessagePortMain = (port: MessagePortMain) =>
  Layer.succeed(WorkerRunner.WorkerRunnerPlatform)(make(port));
