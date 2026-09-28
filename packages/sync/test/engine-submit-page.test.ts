import { describe, expect, it } from "@effect/vitest";
import {
  AuthorityIncarnation,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  PARTITION_DIGEST_VERSION,
  type CommandReceipt,
  type SyncPullRequest,
  type SyncPullResult,
  type SyncSubmitCommandRequest,
  type SyncTransactionGroup,
} from "@store/contracts";
import {
  LAST_UNIT_EPOCH,
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerAEnvelope,
} from "@store/contracts/sync/fixtures";
import { commandOutbox } from "@store/db/replica.schema";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

import { makeSyncEngineFromReplicaStore } from "../src/engine";
import { saveLocalCommand } from "../src/replica/commands";
import { runReplicaTransaction } from "../src/replica/storage";
import { makeSqliteReplicaStore } from "../src/sqlite";
import type { SyncTransport } from "../src/transport";
import { invoicePayloadOf, withSeededReplica } from "./lib/replica-fixture";

const receiptFor = (request: SyncSubmitCommandRequest, commitSequence: string): CommandReceipt => ({
  operationId: request.operationId,
  replicaId: LAST_UNIT_REPLICA_A,
  clientSequence: request.clientSequence,
  payloadHash: request.payloadHash,
  decision: "accepted",
  commitSequence: OrgCommitSequence.make(commitSequence),
  result: {
    _tag: "issueInvoice",
    invoiceId: invoicePayloadOf(request).invoiceId,
    invoiceNumber: 1,
  },
});

const ownGroup = (request: SyncSubmitCommandRequest, commitSequence: string) =>
  ({
    commitSequence: OrgCommitSequence.make(commitSequence),
    operationId: request.operationId,
    decision: "accepted",
    changes: [],
  }) satisfies SyncTransactionGroup;

const pageOf = (
  after: string,
  transactions: ReadonlyArray<SyncTransactionGroup>,
  horizon: string,
): SyncPullResult => ({
  epoch: LAST_UNIT_EPOCH,
  incarnation: AuthorityIncarnation.make("incarnation-test"),
  subscription: OPERATIONAL_SUBSCRIPTION,
  schemaVersion: 1,
  transactions,
  nextCommitSequence: transactions.at(-1)?.commitSequence ?? OrgCommitSequence.make(after),
  horizon: OrgCommitSequence.make(horizon),
  retentionFloor: OrgCommitSequence.make("0"),
});

const unused = {
  registerReplica: () => Effect.die("unused"),
  getReceipt: () => Effect.die("unused"),
  acquireSnapshot: () => Effect.die("unused"),
  readSnapshotPart: () => Effect.die("unused"),
} satisfies Partial<SyncTransport>;

const recordingTransport = (
  answer: (request: SyncSubmitCommandRequest) => SyncPullResult | undefined,
) => {
  const submits: Array<SyncSubmitCommandRequest> = [];
  const pulls: Array<SyncPullRequest> = [];
  const transport: SyncTransport = {
    ...unused,
    submitCommand: (request) =>
      Effect.sync(() => {
        submits.push(request);
        const receipt = receiptFor(request, "1");
        const page = answer(request);
        return page === undefined ? receipt : { ...receipt, page };
      }),
    pull: (request) =>
      Effect.sync(() => {
        pulls.push(request);
        return pageOf(request.afterCommitSequence, [], request.afterCommitSequence);
      }),
  };
  return { transport, submits, pulls };
};

const openEngine = (
  handle: Parameters<typeof makeSqliteReplicaStore>[0],
  transport: SyncTransport,
  options: { readonly pullMaxBytes?: number; readonly verifiedDigestAt?: number } = {},
) =>
  Effect.gen(function* () {
    yield* runReplicaTransaction(handle, (tx) => saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1));
    const store = yield* makeSqliteReplicaStore(handle, "sqlite");
    if (options.verifiedDigestAt !== undefined) {
      yield* store.recordDigestVerification(OPERATIONAL_SUBSCRIPTION, options.verifiedDigestAt);
    }
    const engine = yield* makeSyncEngineFromReplicaStore(
      store,
      yield* Semaphore.make(1),
      transport,
      options.pullMaxBytes === undefined ? {} : { pullMaxBytes: options.pullMaxBytes },
    );
    const outbox = runReplicaTransaction(handle, (tx) =>
      tx.select({ status: commandOutbox.status }).from(commandOutbox).all(),
    ).pipe(Effect.map((rows) => rows.map((row) => row.status)));
    return { engine, store, outbox };
  });

describe("sync engine applies the page that rides on a submit", () => {
  it.effect("integrates the command from the submit page and skips the follow-up pull", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        const recorded = recordingTransport((request) =>
          pageOf("0", [ownGroup(request, "1")], "1"),
        );
        const { engine, store, outbox } = yield* openEngine(handle, recorded.transport, {
          pullMaxBytes: 131_072,
          verifiedDigestAt: 0,
        });

        expect(yield* engine.drainUploads()).toBe(1);
        expect(yield* engine.catchUp()).toBe("advanced");

        expect(recorded.submits).toHaveLength(1);
        expect(recorded.submits[0]).toMatchObject({
          operationId: lastUnitBuyerAEnvelope.operationId,
          afterCommitSequence: "0",
          maxBytes: 131_072,
        });
        expect(recorded.pulls).toHaveLength(0);
        expect(yield* outbox).toEqual(["integrated"]);
        expect((yield* store.readSyncCursor()).appliedCommitSequence).toBe("1");

        yield* engine.setPullMaxBytes(undefined);
        expect(yield* engine.catchUp()).toBe("unchanged");
        expect(recorded.pulls).toEqual([
          { epoch: LAST_UNIT_EPOCH, subscription: "operational", afterCommitSequence: "1" },
        ]);
      }),
    ),
  );

  it.effect("keeps pulling when the page stops short of the horizon", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        const recorded = recordingTransport((request) =>
          pageOf("0", [ownGroup(request, "1")], "3"),
        );
        const { engine, outbox } = yield* openEngine(handle, recorded.transport, {
          verifiedDigestAt: 0,
        });

        yield* engine.drainUploads();
        yield* engine.catchUp();

        expect(yield* outbox).toEqual(["integrated"]);
        expect(recorded.pulls.map((request) => request.afterCommitSequence)).toEqual(["1"]);
        expect(recorded.pulls[0]).not.toHaveProperty("maxBytes");
      }),
    ),
  );

  it.effect("settles the receipt alone and pulls when the authority sends no page", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        const recorded = recordingTransport(() => undefined);
        const { engine, outbox } = yield* openEngine(handle, recorded.transport, {
          verifiedDigestAt: 0,
        });

        yield* engine.drainUploads();
        expect(yield* outbox).toEqual(["accepted_awaiting_integration"]);
        yield* engine.catchUp();

        expect(recorded.pulls.map((request) => request.afterCommitSequence)).toEqual(["0"]);
      }),
    ),
  );

  it.effect("settles the receipt and pulls when the page comes from another incarnation", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        const recorded = recordingTransport((request) => ({
          ...pageOf("0", [ownGroup(request, "1")], "1"),
          incarnation: AuthorityIncarnation.make("incarnation-other"),
        }));
        const { engine, store, outbox } = yield* openEngine(handle, recorded.transport, {
          verifiedDigestAt: 0,
        });

        expect(yield* engine.drainUploads()).toBe(1);
        expect(yield* outbox).toEqual(["accepted_awaiting_integration"]);
        expect((yield* store.readSyncCursor()).appliedCommitSequence).toBe("0");
        yield* engine.catchUp();

        expect(recorded.pulls.map((request) => request.afterCommitSequence)).toEqual(["0"]);
      }),
    ),
  );

  it.effect("still pulls with a digest when verification is due", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        const recorded = recordingTransport((request) =>
          pageOf("0", [ownGroup(request, "1")], "1"),
        );
        const { engine } = yield* openEngine(handle, recorded.transport);

        yield* engine.drainUploads();
        yield* engine.catchUp();

        expect(recorded.pulls).toEqual([
          {
            epoch: LAST_UNIT_EPOCH,
            subscription: "operational",
            afterCommitSequence: "1",
            digestVersion: PARTITION_DIGEST_VERSION,
          },
        ]);
      }),
    ),
  );
});
