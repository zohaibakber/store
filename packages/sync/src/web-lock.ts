import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export type WebLockRefusal = "proceed" | "wait";

const unlocked = (): void => undefined;

const webLocks = (): LockManager | undefined => {
  try {
    return globalThis.navigator?.locks;
  } catch {
    return undefined;
  }
};

const refused = (
  lockName: string,
  whenRefused: WebLockRefusal,
  cause: unknown,
): Effect.Effect<() => void> => {
  const logged = Effect.logWarning("sync.web_lock_refused", cause).pipe(
    Effect.annotateLogs({ lockName, whenRefused }),
  );
  switch (whenRefused) {
    case "proceed":
      return Effect.as(logged, unlocked);
    case "wait":
      return Effect.andThen(logged, Effect.never);
  }
};

export const holdWebLock = (
  lockName: string,
  options: { readonly whenRefused: WebLockRefusal },
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.suspend(() => {
    const locks = webLocks();
    if (locks === undefined) return Effect.void;
    return Effect.acquireRelease(
      Effect.callback<() => void>((resume, signal) => {
        locks
          .request(lockName, { signal }, () =>
            signal.aborted
              ? Promise.resolve()
              : new Promise<void>((release) => resume(Effect.succeed(release))),
          )
          .catch((cause: unknown) => {
            if (!signal.aborted) resume(refused(lockName, options.whenRefused, cause));
          });
      }),
      (release) => Effect.sync(release),
      { interruptible: true },
    ).pipe(Effect.asVoid);
  });
