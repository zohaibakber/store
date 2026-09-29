import { lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import * as Result from "effect/Result";
import { describe, expect, it } from "vitest";

import { decideEnqueue } from "../src/replica/decisions";

describe("replica decisions", () => {
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
});
