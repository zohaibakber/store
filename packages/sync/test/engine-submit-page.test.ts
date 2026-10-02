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

import { makeSyncEngineFromReplicaStore } from "../src/engine";
import { runReplicaTransaction } from "../src/replica/sql-client/handle";
import { makeSqliteReplicaStore } from "../src/replica/sqlite/store";
import type { SyncTransport } from "../src/transport";
import { stubTransport } from "./lib/engine-fixture";
import { enqueueRequestOf } from "./lib/enqueue";
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

const recordingTransport = (
  answer: (request: SyncSubmitCommandRequest) => SyncPullResult | undefined,
) => {
  const submits: Array<SyncSubmitCommandRequest> = [];
  const pulls: Array<SyncPullRequest> = [];
  const transport = stubTransport({
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
  });
  return { transport, submits, pulls };
};

const openEngine = (
  handle: Parameters<typeof makeSqliteReplicaStore>[0],
  transport: SyncTransport,
  options: { readonly pullMaxBytes?: number; readonly verifiedDigestAt?: number } = {},
) =>
  Effect.gen(function* () {
    const store = yield* makeSqliteReplicaStore(handle, "sqlite");
    yield* store.enqueueCommand(enqueueRequestOf(lastUnitBuyerAEnvelope, 1));
    if (options.verifiedDigestAt !== undefined) {
      yield* store.recordDigestVerification(OPERATIONAL_SUBSCRIPTION, options.verifiedDigestAt);
    }
    const engine = yield* makeSyncEngineFromReplicaStore(
      store,
      transport,
      options.pullMaxBytes === undefined ? {} : { pullMaxBytes: options.pullMaxBytes },
    );
    const outbox = runReplicaTransaction(handle, (tx) =>
      tx.select({ status: commandOutbox.status }).from(commandOutbox).all(),
    ).pipe(Effect.map((rows) => rows.map((row) => row.status)));
    return { engine, store, outbox };
  });

describe("sync engine applies the page that rides on a submit", () => {
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
