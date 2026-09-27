import { OrgCommitSequence } from "@store/contracts";
import { LAST_UNIT_REPLICA_A, lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { commandStatus, saveLocalCommand } from "../src/replica/commands";
import { runReplicaTransaction } from "../src/replica/storage";
import { makeSyncEngine } from "../src/sqlite";
import type { SyncTransport } from "../src/transport";
import { withSeededReplica, invoicePayloadOf } from "./lib/replica-fixture";

describe("sync engine permit", () => {
  it("releases the replica permit before the HTTP submit", async () => {
    let held = 0;
    let heldDuringHttp = true;
    const mutex = {
      withPermits:
        (permits: number) =>
        <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          Effect.acquireUseRelease(
            Effect.sync(() => {
              held += permits;
            }),
            () => effect,
            () =>
              Effect.sync(() => {
                held -= permits;
              }),
          ),
    };
    const transport: SyncTransport = {
      registerReplica: () => Effect.die("unused"),
      getReceipt: () => Effect.die("unused"),
      pull: () => Effect.die("unused"),
      submitCommand: () =>
        Effect.sync(() => {
          heldDuringHttp = held > 0;
          return {
            operationId: lastUnitBuyerAEnvelope.operationId,
            replicaId: LAST_UNIT_REPLICA_A,
            clientSequence: lastUnitBuyerAEnvelope.clientSequence,
            payloadHash: lastUnitBuyerAEnvelope.payloadHash,
            decision: "accepted" as const,
            commitSequence: OrgCommitSequence.make("1"),
            result: {
              _tag: "issueInvoice" as const,
              invoiceId: invoicePayloadOf(lastUnitBuyerAEnvelope).invoiceId,
              invoiceNumber: 1,
            },
          };
        }),
      acquireSnapshot: () => Effect.die("unused"),
      readSnapshotPart: () => Effect.die("unused"),
      mintLiveTicket: () => Effect.die("unused"),
    };

    const status = await Effect.runPromise(
      withSeededReplica((store) =>
        Effect.gen(function* () {
          yield* runReplicaTransaction(store, (tx) =>
            saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1),
          );
          const engine = yield* makeSyncEngine(store, mutex, transport);
          yield* engine.uploadOnce();
          return yield* runReplicaTransaction(store, (tx) =>
            commandStatus(tx, lastUnitBuyerAEnvelope.operationId),
          );
        }),
      ),
    );
    expect(heldDuringHttp).toBe(false);
    expect(status).toBe("accepted_awaiting_integration");
  });
});
