import { OrgCommitSequence, SyncCommandEnvelope, syncProtocolError } from "@store/contracts";
import { lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import type { SyncAuthorityContract } from "../../src/inventory/sync-authority";
import { appFor } from "../lib/app";

const commandPost = (body: SyncCommandEnvelope = lastUnitBuyerAEnvelope) =>
  ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) satisfies RequestInit;

describe("sync HTTP", () => {
  it("requires an authenticated organization", async () => {
    const response = await appFor(false).request("/api/sync/commands", commandPost());
    expect(response.status).toBe(401);
  });

  it("returns 503 until the organization store is provisioned", async () => {
    const response = await appFor(true).request("/api/sync/commands", commandPost());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "SYNC_NOT_PROVISIONED" },
    });
  });

  it("maps organization mismatch to 403", async () => {
    const syncAuthority: SyncAuthorityContract = {
      registerReplica: () => Effect.die("unused"),
      getReceipt: () => Effect.die("unused"),
      pull: () => Effect.die("unused"),
      submitCommand: () =>
        Effect.fail(
          syncProtocolError(
            "ORGANIZATION_MISMATCH",
            "The command does not belong to the active organization.",
          ),
        ),
    };
    const response = await appFor(true, { syncAuthority }).request(
      "/api/sync/commands",
      commandPost(),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "ORGANIZATION_MISMATCH" },
    });
  });

  it("returns a receipt from the test authority", async () => {
    const receipt = {
      operationId: lastUnitBuyerAEnvelope.operationId,
      replicaId: lastUnitBuyerAEnvelope.replicaId,
      clientSequence: lastUnitBuyerAEnvelope.clientSequence,
      payloadHash: lastUnitBuyerAEnvelope.payloadHash,
      decision: "accepted" as const,
      commitSequence: OrgCommitSequence.make("1"),
      result: {
        _tag: "issueInvoice" as const,
        invoiceId: lastUnitBuyerAEnvelope.command.payload.invoiceId,
        invoiceNumber: 1,
      },
    };
    const syncAuthority: SyncAuthorityContract = {
      registerReplica: () => Effect.die("unused"),
      getReceipt: () => Effect.succeed(receipt),
      pull: () => Effect.die("unused"),
      submitCommand: () => Effect.succeed(receipt),
    };
    const response = await appFor(true, { syncAuthority }).request(
      "/api/sync/commands",
      commandPost(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      operationId: lastUnitBuyerAEnvelope.operationId,
      decision: "accepted",
    });
  });
});
