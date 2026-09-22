import {
  OrgCommitSequence,
  SyncCommandEnvelope,
  SyncEpoch,
  syncProtocolError,
} from "@store/contracts";
import { lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vitest";

import type { SyncAuthorityContract } from "../../src/inventory/sync-authority";
import type { SyncLiveUpgradeContract } from "../../src/inventory/sync-authority";
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
      acquireSnapshot: () => Effect.die("unused"),
      readSnapshotPart: () => Effect.die("unused"),
      mintLiveTicket: () => Effect.die("unused"),
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
      acquireSnapshot: () => Effect.die("unused"),
      readSnapshotPart: () => Effect.die("unused"),
      mintLiveTicket: () => Effect.die("unused"),
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

  it("maps SNAPSHOT_REQUIRED to 409", async () => {
    const syncAuthority: SyncAuthorityContract = {
      registerReplica: () => Effect.die("unused"),
      getReceipt: () => Effect.die("unused"),
      pull: () =>
        Effect.fail(
          syncProtocolError(
            "SNAPSHOT_REQUIRED",
            "This replica is behind the retained history and needs a snapshot.",
          ),
        ),
      acquireSnapshot: () => Effect.die("unused"),
      readSnapshotPart: () => Effect.die("unused"),
      mintLiveTicket: () => Effect.die("unused"),
      submitCommand: () => Effect.die("unused"),
    };
    const response = await appFor(true, { syncAuthority }).request("/api/sync/pull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        epoch: "1",
        subscription: "operational",
        afterCommitSequence: "0",
      }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "SNAPSHOT_REQUIRED" },
    });
  });

  it("refuses an unauthenticated live upgrade", async () => {
    const response = await appFor(false).request(
      "/api/sync/live?nonce=abababababababababababababababababababababababababababababababab&replicaId=replica-a&subscription=operational",
    );
    expect(response.status).toBe(401);
  });

  it("streams SSE wake hints after a valid ticket query", async () => {
    const nonce = "ab".repeat(32);
    const syncLiveUpgrade: SyncLiveUpgradeContract = {
      handle: (_actor, query, preferSse) =>
        Effect.succeed(
          preferSse
            ? Stream.make({
                event: "wake" as const,
                id: "3",
                data: JSON.stringify({
                  epoch: "1",
                  subscription: query.subscription,
                  horizon: "3",
                }),
              })
            : {
                epoch: SyncEpoch.make("1"),
                subscription: query.subscription,
                horizon: OrgCommitSequence.make("3"),
              },
        ),
    };
    const response = await appFor(true, { syncLiveUpgrade }).request(
      `/api/sync/live?nonce=${nonce}&replicaId=replica-a&subscription=operational`,
      { headers: { accept: "text/event-stream" } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const body = await response.text();
    expect(body).toContain("event: wake");
    expect(body).toContain('"horizon":"3"');
  });

  it("returns a JSON wake hint for long-poll clients", async () => {
    const nonce = "cd".repeat(32);
    const syncLiveUpgrade: SyncLiveUpgradeContract = {
      handle: (_actor, query, preferSse) =>
        Effect.succeed(
          preferSse
            ? undefined
            : {
                epoch: SyncEpoch.make("1"),
                subscription: query.subscription,
                horizon: OrgCommitSequence.make("9"),
              },
        ),
    };
    const response = await appFor(true, { syncLiveUpgrade }).request(
      `/api/sync/live?nonce=${nonce}&replicaId=replica-a&subscription=operational&afterHorizon=0&waitMs=1000`,
      { headers: { accept: "application/json" } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ horizon: "9", subscription: "operational" });
  });
});
