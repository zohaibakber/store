import { OrgCommitSequence } from "@store/contracts";
import { LAST_UNIT_REPLICA_A, lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { makeSyncEngine } from "../src/engine";
import { commandStatus, saveLocalCommand } from "../src/replica/commands";
import { runReplicaTransaction } from "../src/replica/storage";
import type { SyncTransport } from "../src/transport";
import { seedReplicaTenUnits } from "./lib/replica-fixture";

describe("sync engine permit", () => {
  it("releases the replica permit before the HTTP submit", async () => {
    const store = seedReplicaTenUnits();
    runReplicaTransaction(store.db, (tx) => {
      saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1);
    });

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
              invoiceId: lastUnitBuyerAEnvelope.command.payload.invoiceId,
              invoiceNumber: 1,
            },
          };
        }),
    };

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* makeSyncEngine(store.db, mutex, transport);
        yield* engine.uploadOnce();
      }),
    );
    expect(heldDuringHttp).toBe(false);
    runReplicaTransaction(store.db, (tx) => {
      expect(commandStatus(tx, lastUnitBuyerAEnvelope.operationId)).toBe(
        "accepted_awaiting_integration",
      );
    });
    store.close();
  });
});
