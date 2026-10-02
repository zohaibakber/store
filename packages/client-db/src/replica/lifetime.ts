import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";

type ReplicaLifetime = {
  readonly scope: Scope.Scope;
  readonly onClose: (finalizer: Effect.Effect<void>) => void;
  readonly supervise: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  readonly close: () => Promise<void>;
};

export const makeReplicaLifetime = (): ReplicaLifetime => {
  const scope = Scope.makeUnsafe();
  const closing = Effect.runSync(Effect.cached(Scope.close(scope, Exit.void)));
  return {
    scope,
    onClose: (finalizer) => {
      Effect.runSync(Scope.addFinalizer(scope, finalizer));
    },
    supervise: (effect) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.forkIn(effect, scope).pipe(
          Effect.flatMap((fiber) =>
            restore(Fiber.join(fiber)).pipe(Effect.onInterrupt(() => Fiber.interrupt(fiber))),
          ),
        ),
      ),
    close: () => Effect.runPromise(closing),
  };
};
