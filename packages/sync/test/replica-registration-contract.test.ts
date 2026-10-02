import { describe, expect, it } from "@effect/vitest";
import {
  AuthorityIncarnation,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  PARTITION_DIGEST_VERSION,
  ReplicaClientSequence,
  SnapshotId,
  SYNC_SCHEMA_VERSION,
  SyncEpoch,
  syncProtocolError,
  type CatalogRowWrite,
  type RegisterReplicaResult,
  type SyncCommandEnvelope,
  type SyncProtocolError,
} from "@store/contracts";
import { decodeCategoryId } from "@store/contracts/ids";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import { LAST_UNIT_ORGANIZATION_ID, LAST_UNIT_REPLICA_A } from "@store/contracts/sync/fixtures";
import { replicaState } from "@store/db/replica.schema";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import { makeSyncEngineFromReplicaStore } from "../src/engine";
import { SyncRecoveryRequired } from "../src/replica/errors";
import { makeIndexedDbReplicaStore } from "../src/replica/indexeddb/store";
import { PLACEHOLDER_INCARNATION } from "../src/replica/registration";
import { makeSqliteReplicaStore } from "../src/replica/sqlite/store";
import { openReplicaStore, runReplicaTransaction } from "../src/replica/storage";
import type { ReplicaStoreContract } from "../src/replica/store";
import type { SyncSchedulerPolicy } from "../src/scheduler";
import { SyncTransportOffline, type SyncTransport } from "../src/transport";
import { enqueueRequestOf } from "./lib/enqueue";
import { startOwnedSync } from "./lib/owned-sync";
import { acceptedCatalogReceipt, FIXTURE_NOW } from "./lib/pending-fixture";

const USER_ID = "user-1";

const fastPolicy: SyncSchedulerPolicy = {
  activePollMillis: 5,
  backoffMillis: [5],
  hiddenPollMillis: 5,
  liveIdlePollMillis: 5,
};

type Harness = {
  readonly store: ReplicaStoreContract;
  readonly close: Effect.Effect<void>;
};

const makeSqliteHarness = Effect.fn("registration.sqlite")(function* () {
  const scope = yield* Scope.make();
  const handle = yield* Scope.provide(openReplicaStore(), scope);
  yield* runReplicaTransaction(handle, (tx) =>
    tx.insert(replicaState).values({
      id: "singleton",
      organizationId: LAST_UNIT_ORGANIZATION_ID,
      userId: USER_ID,
      replicaId: LAST_UNIT_REPLICA_A,
      epoch: "1",
      incarnation: PLACEHOLDER_INCARNATION,
      appliedCommitSequence: "0",
      nextClientSequence: "1",
      localCommitVersion: 0,
    }),
  ).pipe(Effect.orDie);
  const store = yield* makeSqliteReplicaStore(handle, "sqlite-registration");
  return { store, close: Scope.close(scope, Exit.void) } satisfies Harness;
});

let databaseCounter = 0;

const makeIndexedHarness = Effect.fn("registration.indexeddb")(function* () {
  databaseCounter += 1;
  const databaseName = `replica-registration-${databaseCounter}`;
  const store = yield* makeIndexedDbReplicaStore({
    databaseName,
    databaseIdentity: databaseName,
    identity: {
      organizationId: LAST_UNIT_ORGANIZATION_ID,
      userId: USER_ID,
      replicaId: LAST_UNIT_REPLICA_A,
    },
    indexedDB,
    IDBKeyRange,
  }).pipe(Effect.orDie);
  return {
    store,
    close: store
      .dispose()
      .pipe(Effect.andThen(Effect.sync(() => indexedDB.deleteDatabase(databaseName)))),
  } satisfies Harness;
});

const harnesses: ReadonlyArray<{
  readonly name: string;
  readonly make: () => Effect.Effect<Harness>;
}> = [
  { name: "SQLite", make: makeSqliteHarness },
  { name: "IndexedDB", make: makeIndexedHarness },
];

const withHarness = <A, E>(
  make: () => Effect.Effect<Harness>,
  use: (store: ReplicaStoreContract) => Effect.Effect<A, E>,
) =>
  Effect.acquireUseRelease(
    make(),
    (harness) => use(harness.store),
    (harness) => harness.close,
  );

type AuthorityIdentity = {
  readonly epoch: string;
  readonly incarnation: string;
  readonly nextClientSequence: string;
};

const registration = (identity: AuthorityIdentity): RegisterReplicaResult => ({
  replicaId: LAST_UNIT_REPLICA_A,
  epoch: SyncEpoch.make(identity.epoch),
  incarnation: AuthorityIncarnation.make(identity.incarnation),
  nextClientSequence: ReplicaClientSequence.make(identity.nextClientSequence),
  retentionFloor: OrgCommitSequence.make("0"),
  horizon: OrgCommitSequence.make("0"),
  schemaVersion: 1,
});

type AuthorityCall = "register" | "pull";

const makeAuthority = (
  identity: AuthorityIdentity,
  options: {
    readonly offlineRegistrations?: number;
    readonly pullFailure?: SyncProtocolError;
    readonly calls?: Queue.Enqueue<AuthorityCall>;
    readonly lowestActiveSchemaVersion?: number;
  } = {},
) => {
  const record = (call: AuthorityCall) =>
    options.calls === undefined ? Effect.void : Queue.offer(options.calls, call);
  const counts = { registers: 0, pulls: 0, commits: 0 };
  let offline = options.offlineRegistrations ?? 0;
  let lastSequence = BigInt(identity.nextClientSequence) - 1n;
  const accepted: Array<string> = [];
  const transport: SyncTransport = {
    registerReplica: (request) =>
      Effect.suspend(() => {
        counts.registers += 1;
        return record("register");
      }).pipe(
        Effect.andThen(() => {
          if (offline > 0) {
            offline -= 1;
            return Effect.fail(SyncTransportOffline.make({ message: "offline" }));
          }
          return Effect.succeed({
            ...registration(identity),
            replicaId: request.replicaId,
            lowestActiveSchemaVersion: options.lowestActiveSchemaVersion,
          });
        }),
      ),
    submitCommand: (envelope) =>
      Effect.suspend(() => {
        if (envelope.epoch !== identity.epoch) {
          return Effect.fail(syncProtocolError("EPOCH_MISMATCH", "epoch"));
        }
        const expected = String(lastSequence + 1n);
        if (envelope.clientSequence !== expected) {
          return Effect.fail(syncProtocolError("REPLICA_SEQUENCE_GAP", `expected ${expected}`));
        }
        lastSequence += 1n;
        counts.commits += 1;
        accepted.push(envelope.clientSequence);
        return Effect.succeed(acceptedCatalogReceipt(envelope, String(counts.commits), 1));
      }),
    getReceipt: () => Effect.succeed(undefined),
    pull: (request) =>
      Effect.suspend(() => {
        counts.pulls += 1;
        return record("pull");
      }).pipe(
        Effect.andThen(() => {
          if (options.pullFailure !== undefined) return Effect.fail(options.pullFailure);
          if (request.epoch !== identity.epoch) {
            return Effect.fail(syncProtocolError("EPOCH_MISMATCH", "epoch"));
          }
          return Effect.succeed({
            epoch: SyncEpoch.make(identity.epoch),
            incarnation: AuthorityIncarnation.make(identity.incarnation),
            subscription: OPERATIONAL_SUBSCRIPTION,
            schemaVersion: 1,
            transactions: [],
            nextCommitSequence: request.afterCommitSequence,
            horizon: OrgCommitSequence.make("0"),
            retentionFloor: OrgCommitSequence.make("0"),
          });
        }),
      ),
    acquireSnapshot: (request) =>
      Effect.succeed({
        _tag: "ready" as const,
        manifest: {
          snapshotId: SnapshotId.make(`snapshot-${identity.incarnation}`),
          epoch: request.epoch,
          subscription: request.subscription,
          schemaVersion: 1,
          horizon: OrgCommitSequence.make("0"),
          parts: [],
          entityCounts: [],
          digestVersion: PARTITION_DIGEST_VERSION,
        },
      }),
    readSnapshotPart: () => Effect.die("unused"),
  };
  return { counts, accepted, transport };
};

const categoryWrite = (index: number): CatalogRowWrite => ({
  entity: "category",
  action: "upsert",
  id: decodeCategoryId(`category-${index}`),
  expectedRowVersion: null,
  row: { name: `Category ${index}`, tracksPacks: false },
});

const categoryEnvelope = (
  index: number,
  epoch: string,
  clientSequence: string,
): SyncCommandEnvelope => {
  const operationId = `op-${index}`;
  const command: SyncCommandEnvelope["command"] = {
    _tag: "catalogWrite",
    payload: {
      commandId: operationId,
      deviceId: LAST_UNIT_REPLICA_A,
      occurredAt: FIXTURE_NOW + index,
      writes: [categoryWrite(index)],
    },
  };
  return {
    organizationId: LAST_UNIT_ORGANIZATION_ID,
    epoch: SyncEpoch.make(epoch),
    replicaId: LAST_UNIT_REPLICA_A,
    clientSequence: ReplicaClientSequence.make(clientSequence),
    operationId,
    payloadHash: canonicalPayloadHash(command),
    command,
  };
};

const engineFor = (store: ReplicaStoreContract, transport: SyncTransport) =>
  Semaphore.make(1).pipe(
    Effect.flatMap((mutex) => makeSyncEngineFromReplicaStore(store, mutex, transport)),
  );

type OwnedSync = Effect.Success<ReturnType<typeof startOwnedSync>>;

const statusOf = (owned: OwnedSync) => SubscriptionRef.get(owned.scheduler.status);

const firstSettledStatus = (owned: OwnedSync) =>
  SubscriptionRef.changes(owned.scheduler.status).pipe(
    Stream.filter((status) => status._tag !== "running"),
    Stream.runHead,
  );

const awaitCall = (calls: Queue.Dequeue<AuthorityCall>, call: AuthorityCall) =>
  Queue.take(calls).pipe(Effect.repeat({ until: (taken) => taken === call }), Effect.asVoid);

describe.each(harnesses)("$name replica registration", ({ make }) => {
  it.effect("adopts the authority identity into a fresh replica", () =>
    withHarness(make, (store) =>
      Effect.gen(function* () {
        const identity = { epoch: "4", incarnation: "authority-a", nextClientSequence: "1" };
        const before = yield* store.readSyncCursor();
        expect(before.registered).toBe(false);
        const outcome = yield* store.adoptRegistration(registration(identity), FIXTURE_NOW);
        expect(outcome).toEqual({ _tag: "registered" });
        const after = yield* store.readSyncCursor();
        expect(after).toMatchObject({ epoch: "4", registered: true, appliedCommitSequence: "0" });
        yield* store.verifyAuthority({ incarnation: "authority-a", horizon: "0" });
        yield* store.enqueueCommand(enqueueRequestOf(categoryEnvelope(1, "4", "1"), FIXTURE_NOW));
      }),
    ),
  );

  it.effect("re-stamps never-sent commands and uploads them without a sequence gap", () =>
    withHarness(make, (store) =>
      Effect.gen(function* () {
        yield* store.enqueueCommand(enqueueRequestOf(categoryEnvelope(1, "1", "1"), FIXTURE_NOW));
        yield* store.enqueueCommand(enqueueRequestOf(categoryEnvelope(2, "1", "2"), FIXTURE_NOW));
        const authority = makeAuthority({
          epoch: "2",
          incarnation: "authority-b",
          nextClientSequence: "7",
        });
        const engine = yield* engineFor(store, authority.transport);
        yield* engine.ensureRegistered();
        const first = yield* engine.uploadOnce();
        const second = yield* engine.uploadOnce();
        expect([first?.operationId, second?.operationId]).toEqual(["op-1", "op-2"]);
        expect(authority.accepted).toEqual(["7", "8"]);
        expect(yield* store.readCommandStatus("op-1")).toBe("accepted_awaiting_integration");
        expect(yield* store.readCommandStatus("op-2")).toBe("accepted_awaiting_integration");
        yield* store.enqueueCommand(enqueueRequestOf(categoryEnvelope(3, "2", "9"), FIXTURE_NOW));
        yield* engine.uploadOnce();
        expect(authority.accepted).toEqual(["7", "8", "9"]);
        yield* engine.ensureRegistered();
        expect(authority.counts.registers).toBe(1);
      }),
    ),
  );

  it.effect("keeps allocations that already match the authority", () =>
    withHarness(make, (store) =>
      Effect.gen(function* () {
        yield* store.enqueueCommand(enqueueRequestOf(categoryEnvelope(1, "1", "1"), FIXTURE_NOW));
        const claim = yield* store.claimNextUpload({ claimId: "claim-1", claimedAt: FIXTURE_NOW });
        expect(claim.value?.operationId).toBe("op-1");
        yield* store.releaseUploadClaim("op-1", "claim-1");
        const authority = makeAuthority({
          epoch: "1",
          incarnation: "authority-c",
          nextClientSequence: "1",
        });
        const engine = yield* engineFor(store, authority.transport);
        yield* engine.ensureRegistered();
        yield* engine.uploadOnce();
        expect(authority.accepted).toEqual(["1"]);
      }),
    ),
  );

  it.effect("refuses to re-stamp a conflicting command that was already sent", () =>
    withHarness(make, (store) =>
      Effect.gen(function* () {
        yield* store.enqueueCommand(enqueueRequestOf(categoryEnvelope(1, "1", "1"), FIXTURE_NOW));
        yield* store.claimNextUpload({ claimId: "claim-1", claimedAt: FIXTURE_NOW });
        yield* store.releaseUploadClaim("op-1", "claim-1");
        const authority = makeAuthority({
          epoch: "1",
          incarnation: "authority-d",
          nextClientSequence: "3",
        });
        const engine = yield* engineFor(store, authority.transport);
        const failure = yield* Effect.flip(engine.ensureRegistered());
        expect(failure).toBeInstanceOf(SyncRecoveryRequired);
        expect(failure).toMatchObject({ code: "COMMAND_IDENTITY_MISMATCH" });
        expect((yield* store.readSyncCursor()).registered).toBe(false);
        expect(yield* store.readCommandStatus("op-1")).toBe("pending");
      }),
    ),
  );

  it.effect("refuses a changed authority identity once registered", () =>
    withHarness(make, (store) =>
      Effect.gen(function* () {
        const identity = { epoch: "1", incarnation: "authority-e", nextClientSequence: "1" };
        yield* store.adoptRegistration(registration(identity), FIXTURE_NOW);
        const again = yield* store.adoptRegistration(registration(identity), FIXTURE_NOW + 1);
        expect(again).toEqual({ _tag: "registered" });
        const restored = yield* store.adoptRegistration(
          registration({ ...identity, epoch: "2" }),
          FIXTURE_NOW + 2,
        );
        expect(restored).toMatchObject({ _tag: "refused", code: "EPOCH_MISMATCH" });
        const rekeyed = yield* store.adoptRegistration(
          registration({ ...identity, incarnation: "authority-other" }),
          FIXTURE_NOW + 3,
        );
        expect(rekeyed).toMatchObject({ _tag: "refused", code: "INCARNATION_MISMATCH" });
        expect(yield* store.readSyncCursor()).toMatchObject({ epoch: "1", registered: true });
      }),
    ),
  );

  it.effect("stops with recovery when a registered replica meets a restored authority", () =>
    withHarness(make, (store) =>
      Effect.gen(function* () {
        const identity = { epoch: "1", incarnation: "authority-f", nextClientSequence: "1" };
        yield* store.adoptRegistration(registration(identity), FIXTURE_NOW);
        yield* store.recordCaughtUp(FIXTURE_NOW);
        const authority = makeAuthority(
          { ...identity, epoch: "2" },
          { pullFailure: syncProtocolError("EPOCH_MISMATCH", "The authority was restored.") },
        );
        const owned = yield* startOwnedSync(store, authority.transport, {
          databaseIdentity: `registered-${databaseCounter}`,
          policy: fastPolicy,
        });
        const settled = yield* firstSettledStatus(owned);
        yield* owned.dispose;
        expect(Option.getOrUndefined(settled)).toMatchObject({
          _tag: "recoveryRequired",
          code: "EPOCH_MISMATCH",
        });
        expect(authority.counts.registers).toBe(0);
        expect(authority.counts.pulls).toBe(1);
      }),
    ),
  );

  it.effect("announces again only while another device holds purchasing back", () =>
    withHarness(make, (store) =>
      Effect.gen(function* () {
        const identity = { epoch: "1", incarnation: "authority-h", nextClientSequence: "1" };
        const held = makeAuthority(identity, {
          lowestActiveSchemaVersion: SYNC_SCHEMA_VERSION - 1,
        });
        yield* (yield* engineFor(store, held.transport)).ensureRegistered();
        expect(held.counts.registers).toBe(1);
        expect(yield* store.readSyncCursor()).toMatchObject({
          registered: true,
          announcedSchemaVersion: SYNC_SCHEMA_VERSION,
          lowestActiveSchemaVersion: SYNC_SCHEMA_VERSION - 1,
        });

        const released = makeAuthority(identity, {
          lowestActiveSchemaVersion: SYNC_SCHEMA_VERSION,
        });
        yield* (yield* engineFor(store, released.transport)).ensureRegistered();
        expect(released.counts.registers).toBe(1);
        expect(yield* store.readSyncCursor()).toMatchObject({
          lowestActiveSchemaVersion: SYNC_SCHEMA_VERSION,
        });

        yield* (yield* engineFor(store, released.transport)).ensureRegistered();
        expect(released.counts.registers).toBe(1);
      }),
    ),
  );

  it.effect("retries an offline registration on the next wake without blocking local writes", () =>
    withHarness(make, (store) =>
      Effect.gen(function* () {
        const calls = yield* Queue.unbounded<AuthorityCall>();
        const authority = makeAuthority(
          { epoch: "1", incarnation: "authority-g", nextClientSequence: "1" },
          { offlineRegistrations: 2, calls },
        );
        const owned = yield* startOwnedSync(store, authority.transport, {
          databaseIdentity: `offline-${databaseCounter}`,
          policy: { ...fastPolicy, activePollMillis: 60_000, backoffMillis: [60_000] },
        });
        yield* awaitCall(calls, "register");
        yield* owned.scheduler.wake("reconnect");
        yield* awaitCall(calls, "register");
        expect(authority.counts).toMatchObject({ registers: 2, pulls: 0 });
        expect(yield* statusOf(owned)).toEqual({ _tag: "running" });
        yield* store.enqueueCommand(enqueueRequestOf(categoryEnvelope(1, "1", "1"), FIXTURE_NOW));
        yield* owned.scheduler.wake("reconnect");
        yield* awaitCall(calls, "pull");
        const status = yield* statusOf(owned);
        yield* owned.dispose;
        expect(status).toEqual({ _tag: "running" });
        expect(authority.counts.registers).toBe(3);
        expect(authority.accepted).toEqual(["1"]);
        expect(authority.counts.pulls).toBeGreaterThan(0);
        expect(yield* store.readSyncCursor()).toMatchObject({ registered: true });
      }),
    ),
  );
});

describe("schema version announcement", () => {
  it.effect("registers once more when a replica registered by an older build opens", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const identity = { epoch: "1", incarnation: "authority-i", nextClientSequence: "1" };
        const handle = yield* openReplicaStore();
        yield* runReplicaTransaction(handle, (tx) =>
          tx.insert(replicaState).values({
            id: "singleton",
            organizationId: LAST_UNIT_ORGANIZATION_ID,
            userId: USER_ID,
            replicaId: LAST_UNIT_REPLICA_A,
            epoch: identity.epoch,
            incarnation: identity.incarnation,
            appliedCommitSequence: "0",
            nextClientSequence: "1",
            localCommitVersion: 0,
            registeredAt: FIXTURE_NOW,
          }),
        ).pipe(Effect.orDie);
        const store = yield* makeSqliteReplicaStore(handle, "sqlite-announcement");
        expect(yield* store.readSyncCursor()).toMatchObject({
          registered: true,
          announcedSchemaVersion: undefined,
        });
        const authority = makeAuthority(identity);
        yield* (yield* engineFor(store, authority.transport)).ensureRegistered();
        yield* (yield* engineFor(store, authority.transport)).ensureRegistered();
        expect(authority.counts.registers).toBe(1);
        expect(yield* store.readSyncCursor()).toMatchObject({
          announcedSchemaVersion: SYNC_SCHEMA_VERSION,
          lowestActiveSchemaVersion: undefined,
        });
      }),
    ),
  );
});
