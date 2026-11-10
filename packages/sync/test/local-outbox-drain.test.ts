import { describe, expect, it } from "@effect/vitest";
import {
  type CatalogRowWrite,
  type EnqueueCommandRequest,
  OperationId,
  decodeCategoryId,
} from "@store/contracts";
import { categories, commandOutbox, replicaState } from "@store/db/replica.schema";
import { asc } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_REPLICA_A,
} from "../../contracts/test/fixtures/last-unit-invoice";
import { runReplicaTransaction, SqliteReplica } from "../src/replica/sql-client/handle";
import { layerSqliteReplicaStore, makeSqliteReplicaStore } from "../src/replica/sqlite/store";
import { ReplicaStore } from "../src/replica/store";
import { openReplicaStore } from "../src/sqlite";
import { FIXTURE_NOW } from "./lib/pending-fixture";

const write = (
  index: number,
  name: string,
  expectedRowVersion: number | null,
): CatalogRowWrite => ({
  entity: "category",
  action: "upsert",
  id: decodeCategoryId(`category-${index}`),
  expectedRowVersion,
  row: { name, tracksPacks: false },
});

const request = (
  operation: number,
  writes: ReadonlyArray<CatalogRowWrite>,
): EnqueueCommandRequest => ({
  operationId: OperationId.make(`op-${operation}`),
  occurredAt: FIXTURE_NOW + operation,
  command: {
    _tag: "catalogWrite",
    payload: {
      commandId: `op-${operation}`,
      deviceId: LAST_UNIT_REPLICA_A,
      occurredAt: FIXTURE_NOW + operation,
      writes,
    },
  },
});

describe("a local workspace opened over an outbox left by the queued fallback", () => {
  it.effect(
    "decides and applies every pending command once, and a second open changes nothing",
    () =>
      Effect.gen(function* () {
        const handle = yield* openReplicaStore().pipe(Effect.orDie);
        yield* runReplicaTransaction(handle, (tx) =>
          tx.insert(replicaState).values({
            id: "singleton",
            organizationId: LAST_UNIT_ORGANIZATION_ID,
            userId: "user-1",
            replicaId: LAST_UNIT_REPLICA_A,
            epoch: "1",
            incarnation: "local",
            appliedCommitSequence: "0",
            nextClientSequence: "1",
            localCommitVersion: 0,
          }),
        ).pipe(Effect.orDie);
        const queued = yield* makeSqliteReplicaStore(handle, "drain");
        yield* queued.enqueueCommand(request(1, [write(1, "Painkillers", null)]));
        yield* queued.enqueueCommand(request(2, [write(2, "Vitamins", null)]));
        yield* queued.enqueueCommand(request(3, [write(1, "Pain relief", 1)]));
        yield* queued.enqueueCommand(
          request(4, [
            {
              entity: "category",
              action: "delete",
              id: decodeCategoryId("category-2"),
              expectedRowVersion: 7,
            },
          ]),
        );

        const openLocal = Effect.scoped(
          Layer.build(
            layerSqliteReplicaStore("drain", { decidesLocally: true }).pipe(
              Layer.provide(Layer.succeed(SqliteReplica, handle)),
            ),
          ).pipe(
            Effect.map((context) => Context.get(context, ReplicaStore)),
            Effect.flatMap((store) =>
              Effect.all({
                stamp: store.readStamp,
                cursor: store.readSyncCursor,
                marks: store.readPendingMarks,
              }),
            ),
          ),
        );
        const contents = runReplicaTransaction(handle, (tx) =>
          Effect.all({
            outbox: tx
              .select({ operationId: commandOutbox.operationId, status: commandOutbox.status })
              .from(commandOutbox)
              .orderBy(asc(commandOutbox.operationId))
              .all(),
            categories: tx
              .select({
                id: categories.id,
                name: categories.name,
                rowVersion: categories.rowVersion,
              })
              .from(categories)
              .orderBy(asc(categories.id))
              .all(),
            state: tx.select().from(replicaState).get(),
          }),
        );

        const first = yield* openLocal;
        const afterFirst = yield* contents;
        const second = yield* openLocal;
        const afterSecond = yield* contents;

        expect(afterFirst.outbox).toEqual([
          { operationId: "op-1", status: "integrated" },
          { operationId: "op-2", status: "integrated" },
          { operationId: "op-3", status: "integrated" },
          { operationId: "op-4", status: "rejected" },
        ]);
        expect(afterFirst.categories).toEqual([
          { id: "category-1", name: "Pain relief", rowVersion: 2 },
          { id: "category-2", name: "Vitamins", rowVersion: 1 },
        ]);
        expect(afterFirst.state?.appliedCommitSequence).toBe("4");
        expect(first.marks).toEqual([]);
        expect(first.cursor.bootstrapped).toBe(true);
        expect(second).toEqual(first);
        expect(afterSecond).toEqual(afterFirst);
      }).pipe(Effect.provide(Digest.layerWebCrypto), Effect.scoped),
  );
});
