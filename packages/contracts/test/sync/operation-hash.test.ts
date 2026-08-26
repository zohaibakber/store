import { expect, test } from "vitest";

import { operationPayloadHash } from "../../src/sync/operation-hash";

/** Compat until retirement: Durable Object / `/api/sync/live` WebSocket types. */
test("payload hashes are stable hex sha256 of the canonical operation", () => {
  const hash = operationPayloadHash({
    operationId: "operation-1",
    organizationId: "org-1",
    deviceId: "device-1",
    actorUserId: "user-1",
    clientSequence: 1,
    occurredAt: 1_750_000_000_000,
    changes: [],
  });
  expect(hash).toMatch(/^[0-9a-f]{64}$/);
  expect(
    operationPayloadHash({
      operationId: "operation-1",
      organizationId: "org-1",
      deviceId: "device-1",
      actorUserId: "user-1",
      clientSequence: 1,
      occurredAt: 1_750_000_000_000,
      payloadHash: "ignored",
      changes: [],
    }),
  ).toBe(hash);
});
