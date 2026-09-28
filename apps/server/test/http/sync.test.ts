import {
  OrgCommitSequence,
  SnapshotId,
  SyncCommandEnvelope,
  SyncPullResult,
  syncProtocolError,
} from "@store/contracts";
import { lastUnitBuyerACommand, lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { databaseError } from "../../src/inventory/postgres";
import {
  makeInventorySyncAuthority,
  type SyncAuthorityContract,
} from "../../src/inventory/sync-authority";
import { appFor, workerHandlerFor } from "../lib/app";

const unusedAuthority: SyncAuthorityContract = {
  registerReplica: () => Effect.die("unused"),
  getReceipt: () => Effect.die("unused"),
  pull: () => Effect.die("unused"),
  acquireSnapshot: () => Effect.die("unused"),
  readSnapshotPart: () => Effect.die("unused"),
  submitCommand: () => Effect.die("unused"),
};

const pullPost = {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ epoch: "1", subscription: "operational", afterCommitSequence: "0" }),
} satisfies RequestInit;

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

  it("answers database failures with a generic message and no SQL text", async () => {
    const unused = () => Effect.die("unused");
    const syncAuthority = makeInventorySyncAuthority({
      commands: {
        register: unused,
        receipt: unused,
        pull: unused,
        pullEncoded: unused,
        commit: unused,
        submit: unused,
        submitEncoded: unused,
        submitRaw: () =>
          Effect.fail(
            databaseError(
              new EffectDrizzleQueryError({
                query: 'select "secret_column" from "inventory_state" where "organization_id" = $1',
                params: ["org-private"],
                cause: Cause.fail(new Error("could not serialize access")),
              }),
            ),
          ),
      },
      snapshots: {
        acquireSnapshot: unused,
        readSnapshotPart: unused,
        readSnapshotPartEncoded: unused,
      },
    });
    const response = await appFor(true, { syncAuthority }).request(
      "/api/sync/commands",
      commandPost(),
    );
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toMatchObject({ error: { code: "SYNC_UNAVAILABLE" } });
    expect(text).not.toMatch(/select|secret_column|inventory_state|org-private|Failed query/iu);
  });

  it("maps organization mismatch to 403", async () => {
    const syncAuthority: SyncAuthorityContract = {
      registerReplica: () => Effect.die("unused"),
      getReceipt: () => Effect.die("unused"),
      pull: () => Effect.die("unused"),
      acquireSnapshot: () => Effect.die("unused"),
      readSnapshotPart: () => Effect.die("unused"),
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
        invoiceId: lastUnitBuyerACommand.invoiceId,
        invoiceNumber: 1,
      },
    };
    const syncAuthority: SyncAuthorityContract = {
      registerReplica: () => Effect.die("unused"),
      getReceipt: () => Effect.succeed(receipt),
      pull: () => Effect.die("unused"),
      acquireSnapshot: () => Effect.die("unused"),
      readSnapshotPart: () => Effect.die("unused"),
      submitCommand: () => Effect.succeed({ body: JSON.stringify(receipt), fanout: null }),
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

  it("sends a pull page as the stored JSON without re-encoding it", async () => {
    const json =
      '{"epoch":"1","incarnation":"inc-1","subscription":"operational","schemaVersion":1,' +
      '"transactions":[{"commitSequence":"1","operationId":"op-1","decision":"accepted",' +
      '"changes":[{"entity":"category","action":"upsert","entityId":"general","rowVersion":1,' +
      '"row":{"id":"general","name":"General"}}]}],"nextCommitSequence":"1","horizon":"1",' +
      '"retentionFloor":"0"}';
    const syncAuthority: SyncAuthorityContract = {
      ...unusedAuthority,
      pull: () => Effect.succeed({ json }),
    };
    const response = await appFor(true, { syncAuthority }).request("/api/sync/pull", pullPost);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const text = await response.text();
    expect(text).toBe(json);
    expect(Schema.decodeUnknownSync(Schema.fromJsonString(SyncPullResult))(text)).toMatchObject({
      transactions: [{ changes: [{ row: { id: "general", name: "General" } }] }],
    });
  });

  it("serves snapshot parts as immutable, tagged by content hash", async () => {
    const sha256 = "a".repeat(64);
    const json = '{"snapshotId":"snap-1","partNumber":1,"rows":[]}';
    const syncAuthority: SyncAuthorityContract = {
      ...unusedAuthority,
      readSnapshotPart: () => Effect.succeed({ json, sha256 }),
    };
    const serve = await workerHandlerFor(true, { syncAuthority });
    const fresh = await serve("/api/sync/snapshots/snap-1/parts/1");
    const revalidated = await serve("/api/sync/snapshots/snap-1/parts/1", {
      headers: { "if-none-match": `"${sha256}"` },
    });
    expect(fresh.status).toBe(200);
    expect(await fresh.text()).toBe(json);
    expect(fresh.headers.get("etag")).toBe(`"${sha256}"`);
    expect(fresh.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get("etag")).toBe(`"${sha256}"`);
  });

  it("tells a caller when to retry while a snapshot is building", async () => {
    const syncAuthority: SyncAuthorityContract = {
      ...unusedAuthority,
      acquireSnapshot: () =>
        Effect.succeed({
          _tag: "building" as const,
          snapshotId: SnapshotId.make("snap-building"),
          retryAfterMillis: 15_000,
        }),
    };
    const response = await appFor(true, { syncAuthority }).request("/api/sync/snapshots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ epoch: "1", subscription: "operational" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("retry-after")).toBe("15");
    expect(await response.json()).toMatchObject({ _tag: "building", retryAfterMillis: 15_000 });
  });

  it("rounds Retry-After up to whole seconds", async () => {
    const syncAuthority: SyncAuthorityContract = {
      ...unusedAuthority,
      acquireSnapshot: () =>
        Effect.succeed({
          _tag: "building" as const,
          snapshotId: SnapshotId.make("snap-building"),
          retryAfterMillis: 1_001,
        }),
    };
    const response = await appFor(true, { syncAuthority }).request("/api/sync/snapshots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ epoch: "1", subscription: "operational" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("retry-after")).toBe("2");
  });
});
