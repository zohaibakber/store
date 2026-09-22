import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";

export type ReplicaHandleScope = {
  readonly runInScope: <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) => Promise<A>;
  readonly addFinalizer: (finalizer: Effect.Effect<void, never>) => Promise<void>;
  readonly addSyncFinalizer: (dispose: () => void) => void;
  readonly close: () => void;
  readonly closeSync: () => void;
};

export const openReplicaHandleScope = (): ReplicaHandleScope => {
  const scope = Effect.runSync(Scope.make());
  const runInScope = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
    Effect.runPromise(effect.pipe(Effect.provideService(Scope.Scope, scope)));

  const addSyncFinalizer = (dispose: () => void): void => {
    Effect.runSync(
      Scope.addFinalizer(scope, Effect.sync(dispose)).pipe(
        Effect.provideService(Scope.Scope, scope),
      ),
    );
  };

  return {
    runInScope,
    addFinalizer: (finalizer) => runInScope(Scope.addFinalizer(scope, finalizer)),
    addSyncFinalizer,
    close: () => {
      void Effect.runPromise(Scope.close(scope, Exit.void));
    },
    closeSync: () => {
      Effect.runSync(Scope.close(scope, Exit.void));
    },
  };
};
