import { afterEach, describe, expect, it } from "@effect/vitest";
import {
  AuthorityIncarnation,
  LiveTicket,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  ReplicaClientSequence,
} from "@store/contracts";
import { LAST_UNIT_EPOCH, LAST_UNIT_ORGANIZATION_ID } from "@store/contracts/sync/fixtures";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import { makeIndexedDbReplicaStore } from "../src/replica/indexeddb/store";
import { startOwnedHttpSync } from "../src/session";
import type { SyncTransport } from "../src/transport";

const databaseName = "session-live";

afterEach(() => {
  indexedDB.deleteDatabase(databaseName);
});

const ticket = Schema.decodeUnknownSync(LiveTicket)({
  nonce: "a".repeat(64),
  organizationId: LAST_UNIT_ORGANIZATION_ID,
  subscription: OPERATIONAL_SUBSCRIPTION,
  expiresAt: 4_102_444_800_000,
});

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
  pull: (request) =>
    Effect.succeed({
      epoch: LAST_UNIT_EPOCH,
      incarnation: AuthorityIncarnation.make("authority-1"),
      subscription: OPERATIONAL_SUBSCRIPTION,
      schemaVersion: 1,
      transactions: [],
      nextCommitSequence: request.afterCommitSequence,
      horizon: OrgCommitSequence.make("0"),
      retentionFloor: OrgCommitSequence.make("0"),
    }),
  acquireSnapshot: () => Effect.die("unused"),
  readSnapshotPart: () => Effect.die("unused"),
  mintLiveTicket: () => Effect.succeed(ticket),
};

const pendingLongPolls = Effect.gen(function* () {
  const opened = yield* Queue.unbounded<string>();
  const aborted = yield* Queue.unbounded<string>();
  const fetch: typeof globalThis.fetch = (input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const url = input instanceof Request ? input.url : String(input);
      Queue.offerUnsafe(opened, url);
      init?.signal?.addEventListener("abort", () => {
        Queue.offerUnsafe(aborted, url);
        reject(init.signal?.reason);
      });
    });
  return { opened, aborted, fetch };
});

describe("owned sync live channel", () => {
  it.effect("stops long-polling while hidden and resumes when visible again", () =>
    Effect.gen(function* () {
      const store = yield* makeIndexedDbReplicaStore({
        databaseName,
        databaseIdentity: databaseName,
        identity: {
          organizationId: LAST_UNIT_ORGANIZATION_ID,
          userId: "user-1",
          replicaId: "replica-1",
        },
        indexedDB,
        IDBKeyRange,
      });
      const longPolls = yield* pendingLongPolls;
      const owned = yield* startOwnedHttpSync(store, transport, databaseName, {
        apiBaseUrl: "https://api.tabaaq.test",
        replicaId: "replica-1",
        fetch: longPolls.fetch,
        preferSse: false,
      });
      const first = yield* Queue.take(longPolls.opened);
      expect(first).toContain("/api/sync/live");

      yield* owned.scheduler.setVisible(false);
      expect(yield* Queue.take(longPolls.aborted)).toBe(first);
      yield* TestClock.adjust("10 minutes");
      expect(Option.isNone(yield* Queue.poll(longPolls.opened))).toBe(true);

      yield* owned.scheduler.setVisible(true);
      expect(yield* Queue.take(longPolls.opened)).toContain("/api/sync/live");

      yield* owned.dispose;
      yield* store.dispose();
    }),
  );
});
