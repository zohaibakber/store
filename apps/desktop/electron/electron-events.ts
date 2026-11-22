import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import { reportDesktopError } from "./sentry";

/**
 * Keeps an Electron listener attached for the life of the current scope. The
 * listener itself stays synchronous, because Electron reads `preventDefault`
 * before it yields; it hands any Effect work to a scoped runtime.
 */
export const listen = (
  attach: () => void,
  detach: () => void,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(Effect.sync(attach), () => Effect.sync(detach));

/**
 * Ends a background step that nobody waits on: interruption is normal, and any
 * other failure goes to the log and Sentry under `op`.
 */
export const reported =
  (op: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<void, never, R> =>
    effect.pipe(
      Effect.asVoid,
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.sync(() => reportDesktopError(Cause.squash(cause), { op })),
      ),
    );
