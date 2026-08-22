import {
  exactAcknowledgedOperationIds,
  SyncLiveEvent,
  SyncOperation,
  SyncRequest,
  SyncResponse,
  type SyncAck,
} from "@store/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

const validRequest = {
  protocolVersion: 2,
  organizationId: "org-1",
  deviceId: "device-1",
  cursor: 0,
  operations: [],
};

const validResponse = {
  protocolVersion: 2,
  organizationId: "org-1",
  cursor: 0,
  nextCursor: 0,
  headCursor: 0,
  hasMore: false,
  acknowledgements: [],
  changes: [],
};

describe("sync numeric boundaries", () => {
  const invalidIntegers = [
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ];

  it.each(invalidIntegers)("rejects invalid request cursor %s", (cursor) => {
    expect(Schema.is(SyncRequest)({ ...validRequest, cursor })).toBe(false);
  });

  it.each(invalidIntegers)("rejects invalid response cursor %s", (nextCursor) => {
    expect(
      Schema.is(SyncResponse)({
        ...validResponse,
        cursor: nextCursor,
        nextCursor,
        headCursor: nextCursor,
      }),
    ).toBe(false);
  });

  it("rejects fractional live cursors", () => {
    expect(
      Schema.is(SyncLiveEvent)({ type: "invalidate", protocolVersion: 2, headCursor: 1.5 }),
    ).toBe(false);
  });

  it("rejects zero timestamps and row versions", () => {
    const operation = {
      operationId: "op-1",
      organizationId: "org-1",
      deviceId: "device-1",
      actorUserId: "user-1",
      clientSequence: 1,
      occurredAt: 1,
      payloadHash: "0".repeat(64),
      changes: [
        {
          entity: "product",
          action: "upsert",
          entityId: "product-1",
          rowVersion: 1,
          row: {},
        },
      ],
    } as const;

    expect(Schema.is(SyncOperation)({ ...operation, occurredAt: 0 })).toBe(false);
    expect(
      Schema.is(SyncOperation)({
        ...operation,
        changes: [{ ...operation.changes[0], rowVersion: 0 }],
      }),
    ).toBe(false);
  });
});

describe("sync acknowledgements", () => {
  const operations = [{ operationId: "op-1" }, { operationId: "op-2" }];
  const acknowledgement = (operationId: string): Pick<SyncAck, "operationId"> => ({
    operationId,
  });

  it("returns submitted ids when acknowledgements match exactly", () => {
    expect(
      exactAcknowledgedOperationIds(operations, [acknowledgement("op-2"), acknowledgement("op-1")]),
    ).toEqual(["op-1", "op-2"]);
  });

  it.each([
    ["missing", [acknowledgement("op-1")]],
    ["extra", [acknowledgement("op-1"), acknowledgement("op-2"), acknowledgement("op-3")]],
    ["duplicate", [acknowledgement("op-1"), acknowledgement("op-1")]],
    ["unknown", [acknowledgement("op-1"), acknowledgement("op-3")]],
  ])("rejects %s acknowledgements", (_label, acknowledgements) => {
    expect(exactAcknowledgedOperationIds(operations, acknowledgements)).toBeUndefined();
  });
});
