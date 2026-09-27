import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AuthorityIncarnation,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  ReplicaClientSequence,
  SnapshotId,
  syncProtocolError,
  type SyncPullResult,
} from "@store/contracts";
import { LAST_UNIT_EPOCH, lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import { replicaState } from "@store/db/replica.schema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import { IndexedDbReplicaStore as BrowserIndexedDbReplicaStore } from "../src/browser";
import { SyncEngine } from "../src/engine";
import {
  IndexedDbReplicaStore,
  layerIndexedDbReplicaStore,
  makeIndexedDbReplicaStore,
} from "../src/replica/indexeddb/store";
import { layerSqliteReplicaStore } from "../src/replica/sqlite/store";
import { runReplicaTransaction, SqliteReplica } from "../src/replica/storage";
import { ReplicaStore } from "../src/replica/store";
import { SyncScheduler, type SyncSchedulerPolicy } from "../src/scheduler";
import { layerOwnedHttpSync, startOwnedHttpSync } from "../src/session";
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

const countingTransport = (pullFailure?: ReturnType<typeof syncProtocolError>) => {
  const counts = { pulls: 0, snapshots: 0 };
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
        return pullFailure === undefined ? Effect.succeed(emptyPage) : Effect.fail(pullFailure);
      }),
    acquireSnapshot: () =>
      Effect.sync(() => {
        counts.snapshots += 1;
        return {
          _tag: "building" as const,
          snapshotId: SnapshotId.make("snapshot-building"),
          retryAfterMillis: 1_000,
        };
      }),
    readSnapshotPart: () => Effect.die("unused"),
    mintLiveTicket: () => Effect.die("unused"),
  };
  return { counts, transport };
};

const settle = (millis: number) => new Promise((resolve) => setTimeout(resolve, millis));

afterEach(() => {
  indexedDB.deleteDatabase(databaseName);
});

describe("sync layers", () => {
  it("keeps polling after the fiber that started owned sync has finished", async () => {
    const { counts, transport } = countingTransport();
    const store = await Effect.runPromise(makeIndexedDbReplicaStore(storeInput));
    const owned = await Effect.runPromise(
      startOwnedHttpSync(store, transport, databaseName, undefined, fastPolicy),
    );
    await settle(80);
    expect(counts.pulls).toBeGreaterThan(1);
    await Effect.runPromise(owned.dispose);
    const afterDispose = counts.pulls;
    await settle(40);
    expect(counts.pulls).toBe(afterDispose);
    await Effect.runPromise(store.dispose());
  });

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
    expect(BrowserIndexedDbReplicaStore).toBe(IndexedDbReplicaStore);
    expect(seen.same).toBe(true);
    expect(seen.allocation).toEqual({ epoch: "1", nextClientSequence: "1" });
    expect(seen.statuses).toEqual([]);
  });

  it("composes one ManagedRuntime from the store, transport, and owned sync layers", async () => {
    const { counts, transport } = countingTransport();
    const runtime = ManagedRuntime.make(
      layerOwnedHttpSync({ databaseIdentity: databaseName, policy: fastPolicy }).pipe(
        Layer.provideMerge(layerIndexedDbReplicaStore(storeInput)),
        Layer.provide(Layer.succeed(SyncTransportService, transport)),
      ),
    );
    const status = await runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* ReplicaStore;
        const scheduler = yield* SyncScheduler;
        yield* SyncEngine;
        yield* scheduler.wake("focus");
        return (yield* store.readCommandStatus(lastUnitBuyerAEnvelope.operationId)) ?? "absent";
      }),
    );
    expect(status).toBe("absent");
    await settle(80);
    expect(counts.pulls).toBeGreaterThan(1);
    await runtime.dispose();
    const afterDispose = counts.pulls;
    await settle(40);
    expect(counts.pulls).toBe(afterDispose);
  });

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

  it("stops with a recovery status on an epoch mismatch instead of restoring a snapshot", async () => {
    const { counts, transport } = countingTransport(
      syncProtocolError("EPOCH_MISMATCH", "The authority epoch changed."),
    );
    const store = await Effect.runPromise(makeIndexedDbReplicaStore(storeInput));
    const owned = await Effect.runPromise(
      startOwnedHttpSync(store, transport, databaseName, undefined, fastPolicy),
    );
    await settle(60);
    const status = await Effect.runPromise(SubscriptionRef.get(owned.scheduler.status));
    expect(status._tag).toBe("recoveryRequired");
    expect(counts.snapshots).toBe(0);
    expect(counts.pulls).toBe(1);
    await Effect.runPromise(owned.dispose);
    await Effect.runPromise(store.dispose());
  });
});
