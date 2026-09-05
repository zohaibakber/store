import type { CatalogWriteCommand } from "@store/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { inventoryProtocolError } from "../../src/inventory/errors";
import { appFor } from "../lib/app";

const command = (id: string): CatalogWriteCommand => ({
  operationId: id,
  organizationId: "org-1",
  deviceId: "device",
  actorUserId: "user-1",
  occurredAt: 1,
  entity: "category",
  rows: [
    {
      id,
      name: id,
      tracksPacks: true,
      organizationId: "org-1",
      deviceId: "device",
      createdByUserId: "user-1",
      updatedByUserId: "user-1",
      operationId: id,
      rowVersion: 1,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    },
  ],
});
const request = (ids: string[]) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    commands: ids.map((id) => ({ kind: "catalogWrite", command: command(id) })),
  }),
});

describe("sync command batches", () => {
  it("requires organization authentication", async () => {
    expect((await appFor(false).request("/api/inventory/batch", request(["first"]))).status).toBe(
      401,
    );
  });
  it("preserves order and stops at the first rejection with individual receipts", async () => {
    const calls: string[] = [];
    const app = appFor(true, {
      writeInventoryMutation: (_actor, input) =>
        Effect.gen(function* () {
          calls.push(input.operationId);
          if (input.operationId === "conflict")
            return yield* inventoryProtocolError("ENTITY_CONFLICT", "Changed on another device");
          return { txid: calls.length };
        }),
    });
    const response = await app.request(
      "/api/inventory/batch",
      request(["first", "conflict", "third"]),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [
        { status: "accepted", id: "first", txid: 1 },
        {
          status: "rejected",
          id: "conflict",
          code: "ENTITY_CONFLICT",
          message: "Changed on another device",
        },
      ],
    });
    expect(calls).toEqual(["first", "conflict"]);
  });
  it("rejects batches above the command limit before running any command", async () => {
    let calls = 0;
    const app = appFor(true, {
      writeInventoryMutation: () => Effect.sync(() => ({ txid: ++calls })),
    });
    expect(
      (
        await app.request(
          "/api/inventory/batch",
          request(Array.from({ length: 51 }, (_, index) => String(index))),
        )
      ).status,
    ).toBe(400);
    expect(calls).toBe(0);
  });
});
