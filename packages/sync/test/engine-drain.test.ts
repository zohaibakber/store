import { describe, expect, it } from "@effect/vitest";
import {
  AuthorityIncarnation,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  type CommandReceipt,
  type SyncCommandEnvelope,
  type SyncPullRequest,
  type SyncPullResult,
  type SyncTransactionGroup,
} from "@store/contracts";
import {
  LAST_UNIT_EPOCH,
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerAEnvelope,
  lastUnitBuyerBCommand,
  lastUnitEnvelope,
} from "@store/contracts/sync/fixtures";
import { commandOutbox } from "@store/db/replica.schema";
import * as Effect from "effect/Effect";

import { saveLocalCommand } from "../src/replica/commands";
import { runReplicaTransaction } from "../src/replica/storage";
import { sqliteEngine, stubTransport } from "./lib/engine-fixture";
import { enqueueRequestOf } from "./lib/enqueue";
import { seedCatalogGroup, seedSpareBatchGroup } from "./lib/pending-fixture";
import { invoicePayloadOf, withSeededReplica } from "./lib/replica-fixture";

const secondEnvelope = lastUnitEnvelope({
  replicaId: LAST_UNIT_REPLICA_A,
  clientSequence: "2",
  command: { ...lastUnitBuyerBCommand, invoiceNumber: 2 },
});

const acceptedReceipt = (
  envelope: SyncCommandEnvelope,
  commitSequence: string,
): CommandReceipt => ({
  operationId: envelope.operationId,
  replicaId: LAST_UNIT_REPLICA_A,
  clientSequence: envelope.clientSequence,
  payloadHash: envelope.payloadHash,
  decision: "accepted",
  commitSequence: OrgCommitSequence.make(commitSequence),
  result: {
    _tag: "issueInvoice",
    invoiceId: invoicePayloadOf(envelope).invoiceId,
    invoiceNumber: Number(envelope.clientSequence),
  },
});

const page = (
  request: SyncPullRequest,
  transactions: ReadonlyArray<SyncTransactionGroup>,
  horizon: string,
): SyncPullResult => ({
  epoch: LAST_UNIT_EPOCH,
  incarnation: AuthorityIncarnation.make("incarnation-test"),
  subscription: OPERATIONAL_SUBSCRIPTION,
  schemaVersion: 1,
  transactions,
  nextCommitSequence: transactions.at(-1)?.commitSequence ?? request.afterCommitSequence,
  horizon: OrgCommitSequence.make(horizon),
  retentionFloor: OrgCommitSequence.make("0"),
});

describe("sync engine drains in one cycle", () => {
  it.effect("uploads the whole outbox in client sequence order", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        yield* runReplicaTransaction(handle, (tx) =>
          Effect.gen(function* () {
            yield* saveLocalCommand(tx, enqueueRequestOf(lastUnitBuyerAEnvelope, 1));
            yield* saveLocalCommand(tx, enqueueRequestOf(secondEnvelope, 2));
          }),
        );
        const submitted: Array<string> = [];
        const transport = stubTransport({
          submitCommand: (envelope) =>
            Effect.sync(() => {
              submitted.push(envelope.clientSequence);
              return acceptedReceipt(envelope, envelope.clientSequence);
            }),
        });
        const engine = yield* sqliteEngine(handle, transport);
        expect(yield* engine.drainUploads()).toBe(2);
        expect(submitted).toEqual(["1", "2"]);
        const statuses = yield* runReplicaTransaction(handle, (tx) =>
          tx.select({ status: commandOutbox.status }).from(commandOutbox).all(),
        );
        expect(statuses.map((row) => row.status)).toEqual([
          "accepted_awaiting_integration",
          "accepted_awaiting_integration",
        ]);
        expect(yield* engine.drainUploads()).toBe(0);
        expect(submitted).toHaveLength(2);
      }),
    ),
  );

  it.effect("pulls page after page until the replica reaches the authority horizon", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        const pulls: Array<string> = [];
        const transport = stubTransport({
          pull: (request) =>
            Effect.sync(() => {
              pulls.push(request.afterCommitSequence);
              if (request.afterCommitSequence === "0")
                return page(request, [seedCatalogGroup], "2");
              if (request.afterCommitSequence === "1") {
                return page(request, [seedSpareBatchGroup], "2");
              }
              return page(request, [], "2");
            }),
        });
        const engine = yield* sqliteEngine(handle, transport);
        expect(yield* engine.catchUp()).toBe("advanced");
        expect(pulls).toEqual(["0", "1"]);
        expect(yield* engine.catchUp()).toBe("unchanged");
        expect(pulls).toEqual(["0", "1", "2"]);
      }),
    ),
  );

  it.effect("stops pulling when a page makes no progress toward the horizon", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        let pulls = 0;
        const transport = stubTransport({
          pull: (request) =>
            Effect.sync(() => {
              pulls += 1;
              return page(request, [], "9");
            }),
        });
        const engine = yield* sqliteEngine(handle, transport);
        expect(yield* engine.catchUp()).toBe("unchanged");
        expect(pulls).toBe(1);
      }),
    ),
  );
});
