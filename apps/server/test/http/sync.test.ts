import {
  OrgCommitSequence,
  SnapshotId,
  SyncCommandEnvelope,
  SyncEpoch,
  SyncPullResult,
  syncProtocolError,
} from "@store/contracts";
import { lastUnitBuyerACommand, lastUnitBuyerAEnvelope } from "@store/contracts/sync/fixtures";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vitest";

import { databaseError } from "../../src/inventory/postgres";
import {
  makeInventorySyncAuthority,
  type SyncAuthorityContract,
} from "../../src/inventory/sync-authority";
import type { SyncLiveUpgradeContract } from "../../src/inventory/sync-authority";
import { appFor, workerHandlerFor } from "../lib/app";

const unusedAuthority: SyncAuthorityContract = {
  registerReplica: () => Effect.die("unused"),
  getReceipt: () => Effect.die("unused"),
  pull: () => Effect.die("unused"),
  acquireSnapshot: () => Effect.die("unused"),
  readSnapshotPart: () => Effect.die("unused"),
  mintLiveTicket: () => Effect.die("unused"),
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
        commit: () =>
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
      live: { mintLiveTicket: unused, consumeLiveTicket: unused, readLiveHorizon: unused },
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

  it("accepts a bearer-only live request without a ticket nonce", async () => {
    const seen: Array<string | undefined> = [];
    const syncLiveUpgrade: SyncLiveUpgradeContract = {
      handle: (_actor, query) =>
        Effect.sync(() => {
          seen.push(query.nonce);
          return {
            epoch: SyncEpoch.make("1"),
            subscription: query.subscription,
            horizon: OrgCommitSequence.make("4"),
          };
        }),
    };
    const response = await appFor(true, { syncLiveUpgrade }).request(
      "/api/sync/live?replicaId=replica-a&subscription=operational&afterHorizon=3",
      { headers: { accept: "application/json" } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ horizon: "4" });
    expect(seen).toEqual([undefined]);
  });

  it("serves many requests from one router build and keeps each SSE request scope open until its stream ends", async () => {
    const syncLiveUpgrade: SyncLiveUpgradeContract = {
      handle: () =>
        Effect.gen(function* () {
          const scope = yield* Effect.serviceOption(Scope.Scope);
          let closed = false;
          if (Option.isSome(scope)) {
            yield* Scope.addFinalizer(
              scope.value,
              Effect.sync(() => {
                closed = true;
              }),
            );
          }
          return Stream.fromEffect(
            Effect.sync(() => ({
              event: "wake" as const,
              id: "1",
              data: Option.isNone(scope) ? "no-scope" : closed ? "scope-closed" : "scope-open",
            })),
          );
        }),
    };
    const serve = await workerHandlerFor(true, { syncLiveUpgrade });
    const open = (replicaId: string) =>
      serve(`/api/sync/live?replicaId=${replicaId}&subscription=operational`, {
        headers: { accept: "text/event-stream" },
      });
    const first = await open("replica-a");
    const second = await open("replica-b");
    expect(await first.text()).toContain("data: scope-open");
    expect(await second.text()).toContain("data: scope-open");
  });
});
