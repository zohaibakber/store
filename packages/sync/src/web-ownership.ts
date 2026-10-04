import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import { holdWebLock } from "./web-lock";

export const ownWebNetwork = (
  databaseIdentity: string,
  onOwner: Effect.Effect<void>,
): Effect.Effect<void, never, Scope.Scope> =>
  holdWebLock(`tabaaq.sync.${databaseIdentity}`, { whenRefused: "wait" }).pipe(
    Effect.andThen(onOwner),
    Effect.andThen(Effect.never),
    Effect.scoped,
    Effect.forkScoped,
    Effect.asVoid,
  );
