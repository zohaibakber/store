import { expect, test } from "vitest";

import { canonicalPayloadHash } from "../../src/sync/operation-hash";

test("payload hashes are stable hex sha256 of the canonical payload", () => {
  const hash = canonicalPayloadHash({
    operationId: "operation-1",
    organizationId: "org-1",
    rows: [{ id: "category-1" }],
  });
  expect(hash).toMatch(/^[0-9a-f]{64}$/);
  expect(
    canonicalPayloadHash({
      operationId: "operation-1",
      organizationId: "org-1",
      rows: [{ id: "category-1" }],
    }),
  ).toBe(hash);
});
