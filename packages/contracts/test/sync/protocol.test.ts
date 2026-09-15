import { describe, expect, it } from "vitest";

import { lastUnitBuyerAEnvelope } from "../../src/sync/fixtures/last-unit-invoice";
import { canonicalPayloadHash } from "../../src/sync/operation-hash";
import {
  compareDecimalSequence,
  incrementDecimalSequence,
  SyncCommandEnvelope,
} from "../../src/sync/protocol";

describe("decimal sequences", () => {
  it("compares numerically rather than lexicographically", () => {
    expect(compareDecimalSequence("9", "10")).toBe(-1);
    expect(compareDecimalSequence("10", "9")).toBe(1);
    expect(compareDecimalSequence("01", "1")).toBe(0);
  });

  it("increments without floating point", () => {
    expect(incrementDecimalSequence("9")).toBe("10");
    expect(incrementDecimalSequence("0")).toBe("1");
  });
});

describe("sync command envelope", () => {
  it("hashes the decoded issue-invoice command, ignoring extra JSON keys", () => {
    const decoded = SyncCommandEnvelope.make(lastUnitBuyerAEnvelope);
    const extra = {
      ...lastUnitBuyerAEnvelope,
      command: lastUnitBuyerAEnvelope.command,
      unused: true,
    };
    expect(canonicalPayloadHash(decoded.command)).toBe(lastUnitBuyerAEnvelope.payloadHash);
    expect(canonicalPayloadHash(decoded.command)).not.toBe(canonicalPayloadHash(extra));
  });

  it("keeps invoice commandId on the inner payload equal to the envelope operationId", () => {
    expect(lastUnitBuyerAEnvelope.operationId).toBe(
      lastUnitBuyerAEnvelope.command.payload.commandId,
    );
  });
});
