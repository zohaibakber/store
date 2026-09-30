import { describe, expect, it } from "@effect/vitest";
import {
  AuthorityIncarnation,
  OrgCommitSequence,
  ReplicaClientSequence,
  SyncEpoch,
  type CatalogRowWrite,
  type EnqueueCommandRequest,
  type RegisterReplicaResult,
} from "@store/contracts";
import { decodeCategoryId } from "@store/contracts/ids";
import { LAST_UNIT_ORGANIZATION_ID, LAST_UNIT_REPLICA_A } from "@store/contracts/sync/fixtures";
import { replicaState } from "@store/db/replica.schema";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import { makeIndexedDbReplicaStore } from "../src/replica/indexeddb/store";
import { PLACEHOLDER_INCARNATION } from "../src/replica/registration";
import { makeSqliteReplicaStore } from "../src/replica/sqlite/store";
import { openReplicaStore, runReplicaTransaction } from "../src/replica/storage";
import type { ReplicaStoreContract } from "../src/replica/store";
import { acceptedCatalogReceipt, FIXTURE_NOW } from "./lib/pending-fixture";

type Harness = {
  readonly store: ReplicaStoreContract;
  readonly close: Effect.Effect<void>;
};

const makeSqliteHarness = Effect.fn("enqueue.sqlite")(function* () {
  const scope = yield* Scope.make();
  const handle = yield* Scope.provide(openReplicaStore(), scope);
  yield* runReplicaTransaction(handle, (tx) =>
    tx.insert(replicaState).values({
      id: "singleton",
      organizationId: LAST_UNIT_ORGANIZATION_ID,
      userId: "user-1",
      replicaId: LAST_UNIT_REPLICA_A,
      epoch: "1",
      incarnation: PLACEHOLDER_INCARNATION,
      appliedCommitSequence: "0",
      nextClientSequence: "1",
      localCommitVersion: 0,
    }),
  ).pipe(Effect.orDie);
  const store = yield* makeSqliteReplicaStore(handle, "sqlite-enqueue");
  return { store, close: Scope.close(scope, Exit.void) } satisfies Harness;
});

let databaseCounter = 0;

const makeIndexedHarness = Effect.fn("enqueue.indexeddb")(function* () {
  databaseCounter += 1;
  const databaseName = `replica-enqueue-${databaseCounter}`;
  const store = yield* makeIndexedDbReplicaStore({
    databaseName,
    databaseIdentity: databaseName,
    identity: {
      organizationId: LAST_UNIT_ORGANIZATION_ID,
      userId: "user-1",
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

const categoryWrite = (index: number, name = `Category ${index}`): CatalogRowWrite => ({
  entity: "category",
  action: "upsert",
  id: decodeCategoryId(`category-${index}`),
  expectedRowVersion: null,
  row: { name, tracksPacks: false },
});

const categoryRequest = (index: number, name?: string): EnqueueCommandRequest => ({
  operationId: `op-${index}`,
  occurredAt: FIXTURE_NOW + index,
  command: {
    _tag: "catalogWrite",
    payload: {
      commandId: `op-${index}`,
      deviceId: LAST_UNIT_REPLICA_A,
      occurredAt: FIXTURE_NOW + index,
      writes: [categoryWrite(index, name)],
    },
  },
});

const drainSequences = (store: ReplicaStoreContract, count: number) =>
  Effect.gen(function* () {
    const sequences: Array<string> = [];
    for (let index = 0; index < count; index += 1) {
      const claim = yield* store.claimNextUpload({ claimId: `claim-${index}`, claimedAt: 1 });
      if (!claim.value) break;
      sequences.push(claim.value.envelope.clientSequence);
      yield* store.settleUploadClaim(
        `claim-${index}`,
        acceptedCatalogReceipt(claim.value.envelope, String(index + 1), 1),
      );
    }
    return sequences;
  });

describe.each(harnesses)("$name atomic enqueue", ({ make }) => {
  const withStore = <A, E>(use: (store: ReplicaStoreContract) => Effect.Effect<A, E>) =>
    Effect.acquireUseRelease(
      make(),
      (harness) => use(harness.store),
      (harness) => harness.close,
    );

  it.effect("allocates unique consecutive sequences for concurrent commands", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const requests = Array.from({ length: 8 }, (_, index) => categoryRequest(index + 1));
        const queued = yield* Effect.forEach(requests, (request) => store.enqueueCommand(request), {
          concurrency: "unbounded",
        });
        expect(new Set(queued.map((entry) => entry.value.stamp.localCommitVersion)).size).toBe(8);
        expect(yield* drainSequences(store, 8)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
      }),
    ),
  );

  it.effect("keeps one durable command and projection when an operation repeats", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const request = categoryRequest(1);
        const [first, second] = yield* Effect.all(
          [store.enqueueCommand(request), store.enqueueCommand(request)],
          { concurrency: "unbounded" },
        );
        const third = yield* store.enqueueCommand(request);
        expect(first.value.operationId).toBe("op-1");
        expect(second.value.status).toBe("pending");
        expect(third.notice).toBeUndefined();
        expect(yield* store.readPendingMarks()).toHaveLength(1);
        expect(yield* drainSequences(store, 3)).toEqual(["1"]);
      }),
    ),
  );

  it.effect("rejects a reused operation id with a different payload", () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.enqueueCommand(categoryRequest(1));
        const failure = yield* Effect.flip(store.enqueueCommand(categoryRequest(1, "Renamed")));
        expect(failure).toMatchObject({ _tag: "SyncProtocolError", code: "OPERATION_ID_REUSED" });
        expect(yield* drainSequences(store, 2)).toEqual(["1"]);
      }),
    ),
  );

  it.effect("replays an operation whose envelope was re-stamped by registration", () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.enqueueCommand(categoryRequest(1));
        const authority: RegisterReplicaResult = {
          replicaId: LAST_UNIT_REPLICA_A,
          epoch: SyncEpoch.make("2"),
          incarnation: AuthorityIncarnation.make("authority"),
          nextClientSequence: ReplicaClientSequence.make("7"),
          retentionFloor: OrgCommitSequence.make("0"),
          horizon: OrgCommitSequence.make("0"),
          schemaVersion: 1,
        };
        expect(yield* store.adoptRegistration(authority, FIXTURE_NOW)).toEqual({
          _tag: "registered",
        });
        const replayed = yield* store.enqueueCommand(categoryRequest(1));
        expect(replayed.value.status).toBe("pending");
        const next = yield* store.enqueueCommand(categoryRequest(2));
        expect(next.value.status).toBe("pending");
        expect(yield* drainSequences(store, 3)).toEqual(["7", "8"]);
      }),
    ),
  );
});
