import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EnqueueCommandRequest } from "@store/contracts";
import { openReplicaStore } from "@store/sync/sqlite";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import { describe, expect, it, vi } from "vitest";

import { openSqlClientReplicaHandle } from "../src/replica/sql-client";
import type { ReplicaCommitNotice } from "../src/replica/types";

const noAccessToken = async () => null;

const identity = { organizationId: "org-1", userId: "user-1", replicaId: "replica-1" };

const API_BASE_URL = "https://sync.example.test";

const sqlClientAt = (path: string): Layer.Layer<SqlClient> =>
  Layer.effect(SqlClient, openReplicaStore(path).pipe(Effect.map((handle) => handle.sql)));

const sqlClientLayer = sqlClientAt(":memory:");

const categoryRequest = (): EnqueueCommandRequest =>
  Schema.decodeUnknownSync(EnqueueCommandRequest)({
    operationId: "op-category",
    occurredAt: 1,
    command: {
      _tag: "catalogWrite",
      payload: {
        commandId: "op-category",
        deviceId: identity.replicaId,
        occurredAt: 1,
        writes: [
          {
            entity: "category",
            action: "upsert",
            id: "category-1",
            expectedRowVersion: null,
            row: { name: "Cold chain", tracksPacks: false },
          },
        ],
      },
    },
  });

const unavailableFetch = () => {
  const requested: Array<string> = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    requested.push(input instanceof Request ? input.url : String(input));
    return new Response("unavailable", { status: 503 });
  };
  return { fetch, requested };
};

describe("openSqlClientReplicaHandle", () => {
  it("serves local reads and writes over a generic SqlClient while syncing through the given fetch", async () => {
    const network = unavailableFetch();
    const handle = await openSqlClientReplicaHandle({
      sqlClient: sqlClientLayer,
      databaseName: "sql-client-handle",
      identity,
      sync: {
        apiBaseUrl: API_BASE_URL,
        authenticatedFetch: network.fetch,
        accessToken: noAccessToken,
      },
    });
    const notices: Array<ReplicaCommitNotice> = [];
    const unsubscribe = handle.subscribe((notice) => notices.push(notice));

    expect(handle.engine).toBe("sqlite");
    expect(await handle.readCommandStatus("op-category")).toBeUndefined();
    const before = await handle.stamp();
    expect(before).toEqual({
      workspaceToken: "sql-client-handle",
      generationId: "1",
      localCommitVersion: 0,
    });

    const queued = await handle.enqueueCommand(categoryRequest());
    expect(queued).toEqual({
      operationId: "op-category",
      status: "pending",
      stamp: { workspaceToken: "sql-client-handle", generationId: "1", localCommitVersion: 1 },
    });
    expect(await handle.readCommandStatus("op-category")).toBe("pending");
    expect(await handle.readOutboxStatuses()).toEqual(["pending"]);

    const read = await handle.readSubset({
      source: "categories",
      orderBy: [],
      limit: 10,
      offset: 0,
    });
    expect(read.rows.map((row) => row["name"])).toEqual(["Cold chain"]);
    expect(read.stamp.localCommitVersion).toBeGreaterThan(0);

    await vi.waitFor(() => {
      expect(notices.some((notice) => notice.touchedEntities.includes("category"))).toBe(true);
      expect(network.requested.some((url) => url.startsWith(API_BASE_URL))).toBe(true);
    });

    unsubscribe();
    await handle.close();
  });

  it("keeps the replica identity stored in an existing database file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "replica-identity-"));
    const path = join(directory, "replica.sqlite");
    const open = (replicaId: string) =>
      openSqlClientReplicaHandle({
        sqlClient: sqlClientAt(path),
        databaseName: "sql-client-identity",
        identity: { ...identity, replicaId },
        sync: {
          apiBaseUrl: API_BASE_URL,
          authenticatedFetch: unavailableFetch().fetch,
          accessToken: noAccessToken,
        },
      });
    try {
      const first = await open("replica-1");
      expect(first.replicaId).toBe("replica-1");
      await first.enqueueCommand(categoryRequest());
      await first.close();

      const reopened = await open("replica-minted-later");
      expect(reopened.replicaId).toBe("replica-1");
      expect(await reopened.readOutboxStatuses()).toHaveLength(1);
      await reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reads outbox activity and pending row marks for the sync screen", async () => {
    const handle = await openSqlClientReplicaHandle({
      sqlClient: sqlClientLayer,
      databaseName: "sql-client-activity",
      identity,
      sync: {
        apiBaseUrl: API_BASE_URL,
        authenticatedFetch: unavailableFetch().fetch,
        accessToken: noAccessToken,
      },
    });
    await handle.enqueueCommand(categoryRequest());
    const read = await handle.readSyncActivity?.();
    expect(read?.statuses).toHaveLength(1);
    expect(["pending", "sending"]).toContain(read?.statuses[0]);
    expect(read?.activity.pendingCount).toBe(1);
    expect(read?.activity.rejected).toEqual([]);
    expect(await handle.readPendingRowIds?.("category")).toEqual(["category-1"]);
    await handle.close();
  });

  it("stops network work once disposed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      const network = unavailableFetch();
      const handle = await openSqlClientReplicaHandle({
        sqlClient: sqlClientLayer,
        databaseName: "sql-client-dispose",
        identity,
        sync: {
          apiBaseUrl: API_BASE_URL,
          authenticatedFetch: network.fetch,
          accessToken: noAccessToken,
        },
        policy: {
          activePollMillis: 5,
          backoffMillis: [5],
          hiddenPollMillis: 5,
          liveIdlePollMillis: 5,
        },
      });
      await vi.waitFor(() => expect(network.requested.length).toBeGreaterThan(1));
      await handle.close();
      const settled = network.requested.length;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(network.requested.length).toBe(settled);
    } finally {
      vi.useRealTimers();
    }
  });
});
