import type { SyncRequest } from "@store/contracts";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { syncDatabaseLayer } from "./database";
import { syncProgram, syncServiceLayer, type SyncActor } from "./service";

export const makeSyncRuntime = (storage: DurableObjectStorage) => {
  const runtime = ManagedRuntime.make(
    syncServiceLayer.pipe(Layer.provide(syncDatabaseLayer(storage))),
  );

  return {
    runSync: (actor: SyncActor, request: SyncRequest) =>
      runtime.runPromise(syncProgram(actor, request)),
    dispose: () => runtime.dispose(),
  };
};
