import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as NodeSqlite from "@effect/sql-sqlite-node/SqliteClient";
import { LAST_UNIT_PRODUCT_ID } from "@store/contracts/sync/fixtures";
import { categories, products } from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { describe, expect, it } from "vitest";

import { ReplicaStore } from "../src/replica/store";
import {
  layerSqliteReplicaStore,
  openReplicaStoreFromClient,
  runReplicaTransaction,
  SqliteReplica,
} from "../src/sql-client";
import {
  catalogEnvelope,
  insertCategoryWrite,
  NEW_CATEGORY_ID,
  rejectedReceipt,
  renameProductWrite,
} from "./lib/pending-fixture";
import { seedReplicaTenUnits } from "./lib/replica-fixture";

const seededPath = async () => {
  const path = join(mkdtempSync(join(tmpdir(), "store-sql-client-")), "replica.sqlite");
  await Effect.runPromise(Effect.scoped(seedReplicaTenUnits(path)));
  return path;
};

const genericSqlClient = (path: string): Layer.Layer<SqlClient> =>
  Layer.effect(SqlClient, NodeSqlite.make({ filename: path })).pipe(
    Layer.provide(Reactivity.layer),
  );

const genericReplica = (path: string) =>
  layerSqliteReplicaStore("sql-client-generic").pipe(
    Layer.provideMerge(SqliteReplica.layerFromClient),
    Layer.provide(genericSqlClient(path)),
  );

describe("replica store over a generic SqlClient", () => {
  it("reopens an existing replica and runs the command lifecycle", async () => {
    const path = await seededPath();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* ReplicaStore;
        const handle = yield* SqliteReplica;
        const envelope = catalogEnvelope({
          operationId: "catalog-generic",
          clientSequence: "1",
          writes: [insertCategoryWrite, renameProductWrite("Renamed")],
        });
        const before = yield* store.readStamp();
        const queued = yield* store.enqueueCommand(envelope, 1);
        const shadowed = yield* runReplicaTransaction(handle, (tx) =>
          tx.select().from(products).where(eq(products.id, LAST_UNIT_PRODUCT_ID)).get(),
        );
        const marksWhilePending = yield* store.readPendingMarks();
        const claim = yield* store.claimNextUpload({ claimId: "claim-1", claimedAt: 10 });
        const settled = yield* store.settleUploadClaim("claim-1", rejectedReceipt(envelope, "6"));
        const restored = yield* runReplicaTransaction(handle, (tx) =>
          tx.select().from(products).where(eq(products.id, LAST_UNIT_PRODUCT_ID)).get(),
        );
        const insertedCategory = yield* runReplicaTransaction(handle, (tx) =>
          tx.select().from(categories).where(eq(categories.id, NEW_CATEGORY_ID)).all(),
        );
        return {
          before,
          after: yield* store.readStamp(),
          queued: queued.value.status,
          shadowedName: shadowed?.name,
          marksWhilePending: marksWhilePending.length,
          claimed: claim.value?.operationId,
          settled: settled.value,
          restoredName: restored?.name,
          insertedCategory: insertedCategory.length,
          marksAfter: (yield* store.readPendingMarks()).length,
          status: yield* store.readCommandStatus("catalog-generic"),
        };
      }).pipe(Effect.provide(genericReplica(path))),
    );
    expect(result.before).toEqual({ generationId: "1", localCommitVersion: 0 });
    expect(result.after.localCommitVersion).toBeGreaterThan(0);
    expect(result).toMatchObject({
      queued: "pending",
      shadowedName: "Renamed",
      claimed: "catalog-generic",
      settled: "rejected",
      restoredName: "Ten pack",
      insertedCategory: 0,
      marksAfter: 0,
      status: "rejected",
    });
    expect(result.marksWhilePending).toBeGreaterThan(0);
  });

  it("rolls back every Drizzle statement of a failed transaction", async () => {
    const path = await seededPath();
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const handle = yield* SqliteReplica;
        const failed = yield* runReplicaTransaction(handle, (tx) =>
          tx
            .update(products)
            .set({ name: "Rolled back" })
            .where(eq(products.id, LAST_UNIT_PRODUCT_ID))
            .pipe(Effect.andThen(Effect.fail("abort"))),
        ).pipe(Effect.exit);
        const names = yield* runReplicaTransaction(handle, (tx) =>
          tx.select({ name: products.name }).from(products).values(),
        );
        return { failed: Exit.isFailure(failed), names };
      }).pipe(Effect.provide(genericReplica(path))),
    );
    expect(outcome).toEqual({ failed: true, names: [["Ten pack"]] });
  });

  it("migrates a fresh database idempotently through the public constructor", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "store-sql-client-fresh-")), "replica.sqlite");
    const open = Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqlClient;
        const handle = yield* openReplicaStoreFromClient(sql);
        const ledger = yield* handle.sql.unsafe(`select key from __store_sync_migrations`);
        return ledger.length;
      }).pipe(Effect.provide(genericSqlClient(path))),
    );
    const first = await Effect.runPromise(open);
    const second = await Effect.runPromise(open);
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(first);
  });
});
