import { describe, expect, it } from "@effect/vitest";
import {
  AcquireSnapshotRequest,
  AcquireSnapshotResult,
  decodeSyncLiveServerFrame,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  SnapshotId,
  SnapshotPartPayload,
  SYNC_SCHEMA_VERSION,
  SyncPullRequest,
  SyncPullResult,
  SyncTransactionGroup,
} from "@store/contracts";
import {
  LAST_UNIT_EPOCH,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_REPLICA_A,
} from "@store/contracts/sync/fixtures";
import { replicaState } from "@store/db/replica.schema";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";

import { makeSyncEngineFromReplicaStore } from "../src/engine";
import { runReplicaTransaction } from "../src/replica/sql-client/handle";
import { makeSqliteReplicaStore } from "../src/replica/sqlite/store";
import type { ReplicaStoreContract } from "../src/replica/store";
import { openReplicaStore } from "../src/sqlite";
import { makeSyncTransport, type SyncTransport } from "../src/transport";
import { commitToAuthority } from "./lib/authority-digest";
import { historyAuthorityTransport, makeHistoryAuthority } from "./lib/history-authority";
import { seedCatalogGroup, seedSpareBatchGroup } from "./lib/pending-fixture";
import { FIXTURE_USER_ID } from "./lib/replica-fixture";

const NOW = Date.UTC(2026, 9, 1, 9, 0, 0);

const NEWER_SCHEMA_VERSION = SYNC_SCHEMA_VERSION + 1;

const FOREIGN_ENTITY = "entityFromANewerBuild";

const databaseName = "engine-unknown-entity";

const foreignRow = (entityId: string) => ({
  entity: FOREIGN_ENTITY,
  entityId,
  rowVersion: 1,
  row: { id: entityId, name: "Unreadable", organizationId: LAST_UNIT_ORGANIZATION_ID },
});

const foreignChange = (entityId: string) => ({
  ...foreignRow(entityId),
  action: "upsert",
});

const foreignOnlyGroup = (commitSequence: string): SyncTransactionGroup => ({
  commitSequence: OrgCommitSequence.make(commitSequence),
  operationId: `foreign-write-${commitSequence}`,
  decision: "accepted",
  changes: [],
});

const encodeGroup = Schema.encodeSync(SyncTransactionGroup);
const encodePage = Schema.encodeSync(SyncPullResult);
const encodeAcquired = Schema.encodeSync(AcquireSnapshotResult);
const encodePart = Schema.encodeSync(SnapshotPartPayload);

const wireGroup = (group: SyncTransactionGroup) => {
  const encoded = encodeGroup(group);
  return {
    ...encoded,
    changes: [...encoded.changes, foreignChange(`foreign-${group.commitSequence}`)],
  };
};

const wirePage = (page: SyncPullResult) => ({
  ...encodePage(page),
  schemaVersion: NEWER_SCHEMA_VERSION,
  transactions: page.transactions.map(wireGroup),
});

const wireAcquired = (acquired: AcquireSnapshotResult) => {
  const { manifest, ...encoded } = encodeAcquired(acquired);
  return {
    ...encoded,
    manifest: {
      ...manifest,
      schemaVersion: NEWER_SCHEMA_VERSION,
      entityCounts: [...manifest.entityCounts, { entity: FOREIGN_ENTITY, rowCount: 1 }],
    },
  };
};

const wirePart = (part: SnapshotPartPayload) => {
  const encoded = encodePart(part);
  return {
    ...encoded,
    rows: [foreignRow(`foreign-part-${part.partNumber}`), ...encoded.rows],
  };
};

const wireFrame = (group: SyncTransactionGroup) =>
  JSON.stringify({
    _tag: "transactions",
    epoch: LAST_UNIT_EPOCH,
    subscription: OPERATIONAL_SUBSCRIPTION,
    schemaVersion: NEWER_SCHEMA_VERSION,
    fromCommitSequence: group.commitSequence,
    toCommitSequence: group.commitSequence,
    transactions: [wireGroup(group)],
  });

const decodePullRequest = Schema.decodeUnknownEffect(Schema.fromJsonString(SyncPullRequest));
const decodeAcquireRequest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(AcquireSnapshotRequest),
);

const SNAPSHOT_PART_PATH = /^\/api\/sync\/snapshots\/(?<snapshotId>[^/]+)\/parts\/(?<part>\d+)$/u;

const newerAuthorityResponse = Effect.fn(function* (
  authority: SyncTransport,
  pathname: string,
  bodyText: string,
) {
  if (pathname === "/api/sync/pull") {
    return wirePage(yield* authority.pull(yield* decodePullRequest(bodyText)));
  }
  if (pathname === "/api/sync/snapshots") {
    return wireAcquired(yield* authority.acquireSnapshot(yield* decodeAcquireRequest(bodyText)));
  }
  const part = SNAPSHOT_PART_PATH.exec(pathname)?.groups;
  if (part?.snapshotId !== undefined && part.part !== undefined) {
    return wirePart(
      yield* authority.readSnapshotPart(SnapshotId.make(part.snapshotId), Number(part.part)),
    );
  }
  return yield* Effect.die(`The newer authority has no route for ${pathname}.`);
});

const newerAuthorityTransport = (authority: SyncTransport) =>
  makeSyncTransport("https://api.tabaaq.test").pipe(
    Effect.provide(
      FetchHttpClient.layer.pipe(
        Layer.provide(
          Layer.succeed(FetchHttpClient.Fetch, async (input, init) => {
            const request = new Request(input, init);
            return Response.json(
              await Effect.runPromise(
                newerAuthorityResponse(
                  authority,
                  new URL(request.url).pathname,
                  await request.text(),
                ),
              ),
            );
          }),
        ),
      ),
    ),
  );

const survivesUnknownEntities = Effect.fn(function* (
  store: ReplicaStoreContract,
  incarnation: string,
) {
  yield* TestClock.setTime(NOW);
  const authority = yield* makeHistoryAuthority([], [seedCatalogGroup]);
  const transport = yield* newerAuthorityTransport(
    historyAuthorityTransport(authority, incarnation),
  );
  const engine = yield* makeSyncEngineFromReplicaStore(store, transport);
  const applied = store.readSyncCursor().pipe(Effect.map((cursor) => cursor.appliedCommitSequence));
  const { generationId } = yield* store.readStamp();

  yield* engine.catchUp();
  expect(yield* applied).toBe("1");
  expect((yield* store.readStamp()).generationId).not.toBe(generationId);

  const pulled = [seedSpareBatchGroup, foreignOnlyGroup("3")];
  for (const group of pulled) commitToAuthority(authority.partition, group);
  yield* Ref.update(authority.log, (log) => [...log, ...pulled]);
  yield* engine.catchUp();
  expect(yield* applied).toBe("3");
  expect(yield* store.readDigestVerification(OPERATIONAL_SUBSCRIPTION)).toBe(NOW);

  const frame = decodeSyncLiveServerFrame(wireFrame(foreignOnlyGroup("4")));
  expect(Option.isSome(frame)).toBe(true);
  if (Option.isNone(frame)) return;
  expect(yield* engine.applyLiveFrame(frame.value)).toEqual({ _tag: "applied" });
  expect(yield* applied).toBe("4");
});

describe("sync engine against an authority that replicates entities this build does not know", () => {
  it.effect("applies a snapshot part, a pull page and a live frame into the SQLite replica", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const incarnation = "incarnation-test";
        const handle = yield* openReplicaStore();
        yield* runReplicaTransaction(handle, (tx) =>
          tx.insert(replicaState).values({
            id: "singleton",
            organizationId: LAST_UNIT_ORGANIZATION_ID,
            userId: FIXTURE_USER_ID,
            replicaId: LAST_UNIT_REPLICA_A,
            epoch: LAST_UNIT_EPOCH,
            incarnation,
            appliedCommitSequence: "0",
            nextClientSequence: "1",
            localCommitVersion: 0,
          }),
        ).pipe(Effect.orDie);
        const store = yield* makeSqliteReplicaStore(handle, databaseName);
        yield* survivesUnknownEntities(store, incarnation);
      }),
    ),
  );
});
