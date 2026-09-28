import { describe, expect, it } from "@effect/vitest";
import {
  AuthorityIncarnation,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  SyncEpoch,
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
import * as Semaphore from "effect/Semaphore";

import { saveLocalCommand } from "../src/replica/commands";
import { runReplicaTransaction } from "../src/replica/storage";
import { makeSyncEngine } from "../src/sqlite";
import type { SyncTransport } from "../src/transport";
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

const unused = {
  registerReplica: () => Effect.die("unused"),
  getReceipt: () => Effect.die("unused"),
  acquireSnapshot: () => Effect.die("unused"),
  readSnapshotPart: () => Effect.die("unused"),
} satisfies Partial<SyncTransport>;

describe("sync engine drains in one cycle", () => {
  it.effect("uploads the whole outbox with one command in flight at a time", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        yield* runReplicaTransaction(handle, (tx) =>
          Effect.gen(function* () {
            yield* saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1);
            yield* saveLocalCommand(tx, secondEnvelope, 2);
          }),
        );
        const submitted: Array<string> = [];
        let inFlight = 0;
        let maxInFlight = 0;
        const transport: SyncTransport = {
          ...unused,
          pull: () => Effect.die("unused"),
          submitCommand: (envelope) =>
            Effect.gen(function* () {
              inFlight += 1;
              maxInFlight = Math.max(maxInFlight, inFlight);
              submitted.push(envelope.clientSequence);
              yield* Effect.yieldNow;
              return acceptedReceipt(envelope, envelope.clientSequence);
            }).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  inFlight -= 1;
                }),
              ),
            ),
        };
        const engine = yield* makeSyncEngine(handle, yield* Semaphore.make(1), transport);
        expect(yield* engine.drainUploads()).toBe(2);
        expect(submitted).toEqual(["1", "2"]);
        expect(maxInFlight).toBe(1);
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
        const transport: SyncTransport = {
          ...unused,
          submitCommand: () => Effect.die("unused"),
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
        };
        const engine = yield* makeSyncEngine(handle, yield* Semaphore.make(1), transport);
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
        const transport: SyncTransport = {
          ...unused,
          submitCommand: () => Effect.die("unused"),
          pull: (request) =>
            Effect.sync(() => {
              pulls += 1;
              return page(request, [], "9");
            }),
        };
        const engine = yield* makeSyncEngine(handle, yield* Semaphore.make(1), transport);
        expect(yield* engine.catchUp()).toBe("unchanged");
        expect(pulls).toBe(1);
      }),
    ),
  );

  it.effect("recognises a live hint at or below the applied cursor as already applied", () =>
    withSeededReplica((handle) =>
      Effect.gen(function* () {
        const transport: SyncTransport = {
          ...unused,
          submitCommand: () => Effect.die("unused"),
          pull: (request) =>
            Effect.succeed(
              request.afterCommitSequence === "0"
                ? page(request, [seedCatalogGroup], "1")
                : page(request, [], "1"),
            ),
        };
        const engine = yield* makeSyncEngine(handle, yield* Semaphore.make(1), transport);
        yield* engine.catchUp();
        const hint = (horizon: string, epoch: string = LAST_UNIT_EPOCH) => ({
          epoch: SyncEpoch.make(epoch),
          subscription: OPERATIONAL_SUBSCRIPTION,
          horizon: OrgCommitSequence.make(horizon),
        });
        expect(yield* engine.hintApplied(hint("0"))).toBe(true);
        expect(yield* engine.hintApplied(hint("1"))).toBe(true);
        expect(yield* engine.hintApplied(hint("2"))).toBe(false);
        expect(yield* engine.hintApplied(hint("1", "99"))).toBe(false);
      }),
    ),
  );
});
