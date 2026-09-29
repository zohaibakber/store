import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@effect/vitest";
import {
  AuthorityIncarnation,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  ReplicaClientSequence,
  type SyncPullResult,
} from "@store/contracts";
import { LAST_UNIT_EPOCH, lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import { replicaState } from "@store/db/replica.schema";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Queue from "effect/Queue";
import { TestClock } from "effect/testing";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach } from "vitest";

import { SyncEngine } from "../src/engine";
import { IndexedDbReplicaStore, layerIndexedDbReplicaStore } from "../src/replica/indexeddb/store";
import { layerSqliteReplicaStore } from "../src/replica/sqlite/store";
import { runReplicaTransaction, SqliteReplica } from "../src/replica/storage";
import { ReplicaStore } from "../src/replica/store";
import { SyncScheduler, type SyncSchedulerPolicy } from "../src/scheduler";
import { layerOwnedHttpSync } from "../src/session";
import { SyncTransportService, type SyncTransport } from "../src/transport";
import { seedReplicaTenUnits } from "./lib/replica-fixture";

const databaseName = "sync-layers";

const fastPolicy: SyncSchedulerPolicy = {
  activePollMillis: 5,
  backoffMillis: [5],
  hiddenPollMillis: 5,
  liveIdlePollMillis: 5,
};

const storeInput = {
  databaseName,
  databaseIdentity: databaseName,
  identity: { organizationId: "org-1", userId: "user-1", replicaId: "replica-1" },
  indexedDB,
  IDBKeyRange,
};

const emptyPage: SyncPullResult = {
  epoch: LAST_UNIT_EPOCH,
  incarnation: AuthorityIncarnation.make("authority-1"),
  subscription: OPERATIONAL_SUBSCRIPTION,
  schemaVersion: 1,
  transactions: [],
  nextCommitSequence: OrgCommitSequence.make("0"),
  horizon: OrgCommitSequence.make("0"),
  retentionFloor: OrgCommitSequence.make("0"),
};

const countingTransport = (pulls: Queue.Enqueue<number>) => {
  const counts = { pulls: 0 };
  const transport: SyncTransport = {
    registerReplica: (request) =>
      Effect.succeed({
        replicaId: request.replicaId,
        epoch: LAST_UNIT_EPOCH,
        incarnation: AuthorityIncarnation.make("authority-1"),
        nextClientSequence: ReplicaClientSequence.make("1"),
        retentionFloor: OrgCommitSequence.make("0"),
        horizon: OrgCommitSequence.make("0"),
        schemaVersion: 1,
      }),
    submitCommand: () => Effect.die("unused"),
    getReceipt: () => Effect.die("unused"),
    pull: () =>
      Effect.suspend(() => {
        counts.pulls += 1;
        return Queue.offer(pulls, counts.pulls);
      }).pipe(Effect.as(emptyPage)),
    acquireSnapshot: () => Effect.die("unused"),
    readSnapshotPart: () => Effect.die("unused"),
  };
  return { counts, transport };
};

const driveClock = TestClock.adjust("10 millis").pipe(Effect.forever, Effect.forkScoped);

const advanceWithoutWork = Effect.repeat(TestClock.adjust("50 millis"), { times: 10 });

afterEach(() => {
  indexedDB.deleteDatabase(databaseName);
});

describe("sync layers", () => {
  it("provides the typed IndexedDB store alongside the generic replica store", async () => {
    const runtime = ManagedRuntime.make(layerIndexedDbReplicaStore(storeInput));
    const seen = await runtime.runPromise(
      Effect.gen(function* () {
        const generic = yield* ReplicaStore;
        const typed = yield* IndexedDbReplicaStore;
        const allocation = yield* typed.readCommandAllocation();
        const statuses = yield* typed.listOutboxStatuses();
        return { same: generic === typed, allocation, statuses };
      }),
    );
    await runtime.dispose();
    expect(seen.same).toBe(true);
    expect(seen.allocation).toEqual({ epoch: "1", nextClientSequence: "1" });
    expect(seen.statuses).toEqual([]);
  });

  it.effect("composes one ManagedRuntime from the store, transport, and owned sync layers", () =>
    Effect.gen(function* () {
      const pulls = yield* Queue.unbounded<number>();
      const { counts, transport } = countingTransport(pulls);
      const clock = yield* Clock.clockWith(Effect.succeed);
      const runtime = ManagedRuntime.make(
        layerOwnedHttpSync({ databaseIdentity: databaseName, policy: fastPolicy }).pipe(
          Layer.provideMerge(layerIndexedDbReplicaStore(storeInput)),
          Layer.provide(Layer.succeed(SyncTransportService, transport)),
          Layer.provide(Layer.succeed(Clock.Clock, clock)),
        ),
      );
      const status = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const store = yield* ReplicaStore;
            const scheduler = yield* SyncScheduler;
            yield* SyncEngine;
            yield* scheduler.wake("focus");
            return (yield* store.readCommandStatus(lastUnitBuyerAEnvelope.operationId)) ?? "absent";
          }),
        ),
      );
      expect(status).toBe("absent");
      yield* driveClock;
      yield* Queue.take(pulls);
      yield* Queue.take(pulls);
      yield* Effect.promise(() => runtime.dispose());
      const afterDispose = counts.pulls;
      yield* advanceWithoutWork;
      expect(counts.pulls).toBe(afterDispose);
    }),
  );

  it("layers the SQLite store over the shared replica handle service", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "store-sync-layer-")), "replica.sqlite");
    await Effect.runPromise(Effect.scoped(seedReplicaTenUnits(path)));
    const stamps = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* ReplicaStore;
        const handle = yield* SqliteReplica;
        const before = yield* store.readStamp();
        yield* runReplicaTransaction(handle, (tx) =>
          tx.update(replicaState).set({ localCommitVersion: 5 }),
        );
        return { before, after: yield* store.readStamp() };
      }).pipe(
        Effect.provide(
          layerSqliteReplicaStore("sqlite-layer").pipe(
            Layer.provideMerge(SqliteReplica.layer(path)),
          ),
        ),
      ),
    );
    expect(stamps).toEqual({
      before: { generationId: "1", localCommitVersion: 0 },
      after: { generationId: "1", localCommitVersion: 5 },
    });
  });
});
