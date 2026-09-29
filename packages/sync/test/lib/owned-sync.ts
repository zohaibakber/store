import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import { ReplicaStore, type ReplicaStoreContract } from "../../src/replica/store";
import { SyncScheduler } from "../../src/scheduler";
import { layerOwnedHttpSync, type OwnedHttpSyncOptions } from "../../src/session";
import { SyncTransportService, type SyncTransport } from "../../src/transport";

export const startOwnedSync = (
  store: ReplicaStoreContract,
  transport: SyncTransport,
  options: OwnedHttpSyncOptions,
) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      layerOwnedHttpSync(options).pipe(
        Layer.provide(Layer.succeed(ReplicaStore, store)),
        Layer.provide(Layer.succeed(SyncTransportService, transport)),
      ),
      scope,
    ).pipe(Effect.orDie);
    return {
      scheduler: Context.get(context, SyncScheduler),
      dispose: Scope.close(scope, Exit.void),
    };
  });
