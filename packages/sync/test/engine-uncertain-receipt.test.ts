import { it } from "@effect/vitest";
import { OrgCommitSequence } from "@store/contracts";
import { LAST_UNIT_REPLICA_A, lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import { commandOutbox } from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import { expect } from "vitest";

import { makeSyncEngine } from "../src/engine";
import { claimNextUpload, releaseUploadClaim, saveLocalCommand } from "../src/replica/commands";
import { runReplicaTransaction } from "../src/replica/storage";
import type { SyncTransport } from "../src/transport";
import { seedReplicaTenUnits } from "./lib/replica-fixture";

const acceptedReceipt = {
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

it.effect("looks up a receipt before retrying an uncertain command", () =>
  Effect.acquireUseRelease(
    Effect.sync(seedReplicaTenUnits),
    (store) =>
      Effect.gen(function* () {
        runReplicaTransaction(store.db, (tx) => {
          saveLocalCommand(tx, lastUnitBuyerAEnvelope, 1);
          const claim = claimNextUpload(tx, { claimId: "claim-1", claimedAt: 1 });
          if (!claim) throw new Error("Expected an upload claim.");
          releaseUploadClaim(tx, claim.operationId, claim.claimId);
        });
        let submitCalls = 0;
        const mutex = yield* Semaphore.make(1);
        const transport: SyncTransport = {
          registerReplica: () => Effect.die("unused"),
          getReceipt: () => Effect.succeed(acceptedReceipt),
          pull: () => Effect.die("unused"),
          submitCommand: () =>
            Effect.sync(() => {
              submitCalls += 1;
              return acceptedReceipt;
            }),
          acquireSnapshot: () => Effect.die("unused"),
          readSnapshotPart: () => Effect.die("unused"),
          mintLiveTicket: () => Effect.die("unused"),
        };
        const engine = yield* makeSyncEngine(store.db, mutex, transport);
        const receipt = yield* engine.uploadOnce();
        expect(receipt).toEqual(acceptedReceipt);
        expect(submitCalls).toBe(0);
        const row = runReplicaTransaction(store.db, (tx) =>
          tx
            .select()
            .from(commandOutbox)
            .where(eq(commandOutbox.operationId, lastUnitBuyerAEnvelope.operationId))
            .get(),
        );
        expect(row?.status).toBe("accepted_awaiting_integration");
      }),
    (store) => Effect.sync(store.close),
  ),
);
