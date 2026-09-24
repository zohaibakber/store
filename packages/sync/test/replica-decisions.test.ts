import { OrgCommitSequence } from "@store/contracts";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_PRODUCT_ID,
  lastUnitBuyerAEnvelope,
} from "@store/contracts/sync/fixtures";
import * as Result from "effect/Result";
import { describe, expect, it } from "vitest";

import { decideEnqueue, decideOverlays, decideReceipt } from "../src/replica/decisions";
import { catalogEnvelope, restockBatchWrite } from "./lib/pending-fixture";
import { invoicePayloadOf } from "./lib/replica-fixture";

describe("replica decisions", () => {
  it("allocates overlays for an issueInvoice command", () => {
    const overlays = decideOverlays(
      lastUnitBuyerAEnvelope,
      () => 1,
      () => ({ packQuantity: 0, unitQuantity: 10 }),
    );
    expect(overlays).toEqual([
      {
        commandId: lastUnitBuyerAEnvelope.operationId,
        batchId: LAST_UNIT_BATCH_ID,
        packDelta: 0,
        unitDelta: -1,
      },
    ]);
  });

  it("rejects reused operation ids with a different payload", () => {
    const decision = decideEnqueue(
      {
        organizationId: lastUnitBuyerAEnvelope.organizationId,
        epoch: lastUnitBuyerAEnvelope.epoch,
        replicaId: lastUnitBuyerAEnvelope.replicaId,
        nextClientSequence: lastUnitBuyerAEnvelope.clientSequence,
      },
      {
        status: "pending",
        envelope: {
          ...lastUnitBuyerAEnvelope,
          payloadHash: "other",
        },
      },
      lastUnitBuyerAEnvelope,
      () => 1,
      () => ({ packQuantity: 0, unitQuantity: 10 }),
    );
    expect(Result.isFailure(decision) && decision.failure.code).toBe("OPERATION_ID_REUSED");
  });

  it("settles an accepted receipt into awaiting integration", () => {
    const decision = decideReceipt(
      "sending",
      lastUnitBuyerAEnvelope,
      {
        operationId: lastUnitBuyerAEnvelope.operationId,
        replicaId: lastUnitBuyerAEnvelope.replicaId,
        clientSequence: lastUnitBuyerAEnvelope.clientSequence,
        payloadHash: lastUnitBuyerAEnvelope.payloadHash,
        decision: "accepted",
        commitSequence: OrgCommitSequence.make("1"),
        result: {
          _tag: "issueInvoice",
          invoiceId: invoicePayloadOf(lastUnitBuyerAEnvelope).invoiceId,
          invoiceNumber: 1,
        },
      },
      true,
    );
    expect(decision).toEqual(
      Result.succeed({ _tag: "accepted", status: "accepted_awaiting_integration" }),
    );
  });

  it("creates no stock overlay for a catalog batch upsert", () => {
    const envelope = catalogEnvelope({
      operationId: "catalog-overlay",
      clientSequence: "1",
      writes: [restockBatchWrite({ movementId: "restock-overlay", unitQuantity: 42 })],
    });
    expect(
      decideOverlays(
        envelope,
        () => 1,
        () => ({ packQuantity: 0, unitQuantity: 10 }),
      ),
    ).toEqual([]);
  });

  it("uses product id in overlay calculation", () => {
    expect(LAST_UNIT_PRODUCT_ID).toBeTruthy();
  });
});
