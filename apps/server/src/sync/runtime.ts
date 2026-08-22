import type { SyncRequest, SyncResponse } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { syncDatabaseLayer } from "./database";
import { SyncDatabaseError, SyncProtocolError } from "./errors";
import { syncHeadProgram, syncProgram, syncServiceLayer, type SyncActor } from "./service";

export interface SyncRuntime {
  readonly runSync: (actor: SyncActor, request: SyncRequest) => Promise<SyncResponse>;
  readonly headCursor: (organizationId: string) => Promise<number>;
  readonly dispose: () => Promise<void>;
}

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export const syncRuntimeHeadCursor = (
  runtime: Pick<SyncRuntime, "headCursor">,
  organizationId: string,
): Effect.Effect<number, SyncDatabaseError> =>
  Effect.tryPromise({
    try: () => runtime.headCursor(organizationId),
    catch: (cause) =>
      cause instanceof SyncDatabaseError
        ? cause
        : SyncDatabaseError.make({ message: messageOf(cause), cause }),
  });

export const syncRuntimeExchange = (
  runtime: Pick<SyncRuntime, "runSync">,
  actor: SyncActor,
  request: SyncRequest,
): Effect.Effect<SyncResponse, SyncProtocolError | SyncDatabaseError> =>
  Effect.tryPromise({
    try: () => runtime.runSync(actor, request),
    catch: (cause): SyncProtocolError | SyncDatabaseError => {
      if (cause instanceof SyncProtocolError || cause instanceof SyncDatabaseError) return cause;
      return SyncDatabaseError.make({ message: messageOf(cause), cause });
    },
  });

export const disposeSyncRuntime = (runtime: Pick<SyncRuntime, "dispose">): Effect.Effect<void> =>
  Effect.tryPromise({
    try: () => runtime.dispose(),
    catch: (cause) => cause,
  }).pipe(
    Effect.tapError((cause) => Effect.logError("Sync runtime disposal failed", cause)),
    Effect.ignore,
  );

export const makeSyncRuntime = (storage: DurableObjectStorage): SyncRuntime => {
  const runtime = ManagedRuntime.make(
    syncServiceLayer.pipe(Layer.provide(syncDatabaseLayer(storage))),
  );

  return {
    runSync: (actor, request) => runtime.runPromise(syncProgram(actor, request)),
    headCursor: (organizationId) => runtime.runPromise(syncHeadProgram(organizationId)),
    dispose: () => runtime.dispose(),
  };
};
