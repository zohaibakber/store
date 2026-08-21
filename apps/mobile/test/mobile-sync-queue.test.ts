import { describe, expect, it, vi } from "vitest";

import {
  type MobileSyncOperation,
  reattributePendingOperations,
} from "../src/lib/mobile-sync-queue";

type Change = { readonly entityId: string };

const operation = (actorUserId: string): MobileSyncOperation<Change> => ({
  operationId: "operation-1",
  organizationId: "organization-1",
  deviceId: "device-1",
  actorUserId,
  clientSequence: 1,
  occurredAt: 1,
  payloadHash: "old-hash",
  changes: [{ entityId: "product-1" }],
});

describe("mobile sync queue", () => {
  it("reattributes and rehashes operations created before the auth migration", async () => {
    const hash = vi.fn(
      async (input: Omit<MobileSyncOperation<Change>, "payloadHash">) =>
        `hash-for-${input.actorUserId}`,
    );
    const result = await reattributePendingOperations(
      [operation("legacy-user")],
      "current-user",
      hash,
    );

    expect(result.changed).toBe(true);
    expect(result.operations[0]).toMatchObject({
      actorUserId: "current-user",
      payloadHash: "hash-for-current-user",
    });
    expect(hash).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: "current-user", operationId: "operation-1" }),
    );
  });

  it("leaves current-user operations and hashes untouched", async () => {
    const current = operation("current-user");
    const hash = vi.fn();
    const result = await reattributePendingOperations([current], "current-user", hash);

    expect(result).toEqual({ operations: [current], changed: false });
    expect(hash).not.toHaveBeenCalled();
  });
});
