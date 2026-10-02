import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

const hasWebLocks = (): boolean => {
  try {
    return globalThis.navigator !== undefined && globalThis.navigator.locks !== undefined;
  } catch {
    return false;
  }
};

const holdWebLock = (lockName: string): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.callback<() => void>((resume, signal) => {
      globalThis.navigator.locks
        .request(lockName, { signal }, () =>
          signal.aborted
            ? Promise.resolve()
            : new Promise<void>((release) => resume(Effect.succeed(release))),
        )
        .catch(() => undefined);
    }),
    (release) => Effect.sync(release),
    { interruptible: true },
  ).pipe(Effect.asVoid);

export const ownWebNetwork = (
  databaseIdentity: string,
  onOwner: Effect.Effect<void>,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.suspend(() =>
    hasWebLocks()
      ? holdWebLock(`tabaaq.sync.${databaseIdentity}`).pipe(
          Effect.andThen(onOwner),
          Effect.andThen(Effect.never),
          Effect.scoped,
          Effect.forkScoped,
          Effect.asVoid,
        )
      : onOwner,
  );
