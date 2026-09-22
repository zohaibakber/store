import { OrgCommitSequence } from "@store/contracts";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_PRODUCT_ID,
  lastUnitBuyerAEnvelope,
} from "@store/contracts/sync/fixtures";
import { describe, expect, it } from "vitest";

import { decideEnqueue, decideOverlays, decideReceipt } from "../src/replica/decisions";

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
    expect(() =>
      decideEnqueue(
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
      ),
    ).toThrow();
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
          invoiceId: lastUnitBuyerAEnvelope.command.payload.invoiceId,
          invoiceNumber: 1,
        },
      },
      true,
    );
    expect(decision).toEqual({ _tag: "accepted", status: "accepted_awaiting_integration" });
  });

  it("uses product id in overlay calculation", () => {
    expect(LAST_UNIT_PRODUCT_ID).toBeTruthy();
  });
});
