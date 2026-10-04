import { InventoryStore } from "@store/contracts/replica";
import { ReplicaStore, SyncScheduler } from "@store/sync";
import {
  readOutboxActivitySqlite,
  readPendingRowIdsSqlite,
  SqliteReplica,
} from "@store/sync/sql-client";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { replicaSyncActivityOf } from "../replica/activity";
import { sameSyncHealth, syncHealthOf } from "../replica/status";
import { CommandAdmission } from "./admission";
import { makeCommandHandlers } from "./commands";
import { coalescedNotices, openingNotice } from "./commit-notices";
import { readFailure } from "./failures";

export const layerInventoryStore: Layer.Layer<
  Rpc.ToHandler<RpcGroup.Rpcs<typeof InventoryStore>>,
  never,
  CommandAdmission | ReplicaStore | SyncScheduler | SqliteReplica
> = InventoryStore.toLayer(
  Effect.gen(function* () {
    const admission = yield* CommandAdmission;
    const store = yield* ReplicaStore;
    const scheduler = yield* SyncScheduler;
    const replica = yield* SqliteReplica;
    const wakes = yield* Ref.make(0);

    const stamp = Effect.mapError(store.readStamp(), readFailure);

    return InventoryStore.of({
      ...makeCommandHandlers({ admission, store, scheduler, replica }),
      Commits: ({ after }) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const notices = yield* coalescedNotices(store.commits);
            const current = yield* stamp;
            return Stream.concat(Stream.make(openingNotice(current, after)), notices);
          }),
        ),
      Health: () =>
        SubscriptionRef.changes(scheduler.state).pipe(
          Stream.map(syncHealthOf),
          Stream.changesWith(sameSyncHealth),
        ),
      Stamp: () => stamp,
      SyncActivity: () =>
        readOutboxActivitySqlite(replica.db).pipe(
          Effect.map(replicaSyncActivityOf),
          Effect.mapError(readFailure),
        ),
      PendingRows: ({ entity }) =>
        readPendingRowIdsSqlite(replica.db, entity).pipe(Effect.mapError(readFailure)),
      WakeSyncUpload: () =>
        scheduler.wake("localWrite").pipe(
          Effect.andThen(Ref.updateAndGet(wakes, (count) => count + 1)),
          Effect.map((drainCount) => ({ drained: true, drainCount })),
        ),
    });
  }),
);

export { CommandAdmission } from "./admission";
