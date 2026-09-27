import { SyncCommandEnvelope } from "@store/contracts";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  rejectedCommandFromOutbox,
  syncActivityFromOutbox,
  syncStatusFromActivity,
} from "../src/replica/activity";

const batchWriteCommand = {
  _tag: "catalogWrite",
  payload: {
    commandId: "op-3",
    deviceId: "replica-1",
    occurredAt: 1,
    writes: [
      {
        entity: "batch",
        action: "upsert",
        id: "batch-1",
        expectedRowVersion: 2,
        movementId: "movement-1",
        note: null,
        row: {
          productId: "product-9",
          batchNumber: "B-9",
          expiresAt: null,
          packQuantity: 1,
          unitQuantity: 0,
        },
      },
    ],
  },
};

const envelopeJson = () => {
  const draft = Schema.decodeUnknownSync(SyncCommandEnvelope)({
    organizationId: "org-1",
    epoch: "1",
    replicaId: "replica-1",
    clientSequence: "3",
    operationId: "op-3",
    payloadHash: canonicalPayloadHash("placeholder"),
    command: batchWriteCommand,
  });
  return Schema.encodeSync(Schema.fromJsonString(SyncCommandEnvelope))({
    ...draft,
    payloadHash: canonicalPayloadHash(draft.command),
  });
};

const rejectedReceiptJson = JSON.stringify({
  operationId: "op-3",
  replicaId: "replica-1",
  clientSequence: "3",
  payloadHash: canonicalPayloadHash(batchWriteCommand),
  decision: "rejected",
  commitSequence: "12",
  result: { _tag: "rejected", code: "ENTITY_CONFLICT", message: "The batch changed." },
});

describe("sync activity", () => {
  it("names the rejection reason and the product a rejected batch write belongs to", () => {
    const rejected = rejectedCommandFromOutbox({
      operationId: "op-3",
      clientSequence: "3",
      createdAt: 30,
      envelopeJson: envelopeJson(),
      receiptJson: rejectedReceiptJson,
    });
    expect(Option.getOrThrow(rejected)).toEqual({
      operationId: "op-3",
      clientSequence: "3",
      createdAt: 30,
      command: "catalogWrite",
      code: "ENTITY_CONFLICT",
      message: "The batch changed.",
      targets: [{ entity: "batch", id: "batch-1" }],
      productId: "product-9",
    });
  });

  it("falls back to a generic reason without a receipt and skips corrupt envelopes", () => {
    const withoutReceipt = rejectedCommandFromOutbox({
      operationId: "op-3",
      clientSequence: "3",
      createdAt: 30,
      envelopeJson: envelopeJson(),
      receiptJson: null,
    });
    expect(Option.getOrThrow(withoutReceipt)).toMatchObject({
      code: "UNKNOWN",
      message: "The server rejected this change.",
    });
    expect(
      rejectedCommandFromOutbox({
        operationId: "op-4",
        clientSequence: "4",
        createdAt: 40,
        envelopeJson: "{",
        receiptJson: null,
      }),
    ).toEqual(Option.none());
  });

  it("counts outstanding commands and derives the sync status from the outbox", () => {
    const outbox = {
      statusCounts: [
        { status: "pending", count: 2 },
        { status: "accepted_awaiting_integration", count: 1 },
      ],
      rejected: [],
      caughtUpAt: 55,
    } satisfies Parameters<typeof syncActivityFromOutbox>[0];
    expect(syncActivityFromOutbox(outbox)).toEqual({
      pendingCount: 3,
      rejectedCount: 0,
      rejected: [],
      lastCaughtUpAt: 55,
    });
    expect(syncStatusFromActivity(outbox)).toEqual({ _tag: "pendingConfirmation" });
    expect(syncStatusFromActivity({ ...outbox, statusCounts: [] })).toEqual({ _tag: "caughtUp" });
  });
});
