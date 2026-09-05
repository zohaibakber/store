import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";

import {
  makeMemoryReplicaStore,
  visibleRowsForStore,
} from "../src/persistence";

const row = (id: string, name: string) => ({ id, name, rowVersion: 1 });
const change = (id: string, value: Record<string, unknown>) => ({
  entity: "category" as const,
  action: "upsert" as const,
  entityId: id,
  rowVersion: 1,
  row: value,
});
const entry = (id: string) => ({
  id,
  lane: "catalog" as const,
  kind: "catalogWrite" as const,
  command: {
    operationId: id,
    organizationId: "org",
    deviceId: "device",
    actorUserId: "user",
    occurredAt: 1,
    entity: "category" as const,
    rows: [row(id, id)],
  },
});

describe("replica persistence operations", () => {
  it("keeps canonical rows separate from optimistic outbox rows", async () => {
    const store = makeMemoryReplicaStore();
    const result = await Effect.runPromise(
      store.transaction("scope", (transaction) => {
        transaction.appendOutbox(entry("one"), [change("one", row("one", "local"))]);
        return "queued";
      }),
    );

    expect(result.result).toBe("queued");
    expect(result.snapshot.rows.category).toEqual([]);
    expect(result.snapshot.outbox).toHaveLength(1);
    expect(visibleRowsForStore(result.snapshot).category).toEqual([row("one", "one")]);
  });

  it("moves an acknowledged command to an overlay and clears it at the transaction end", async () => {
    const store = makeMemoryReplicaStore();
    await Effect.runPromise(store.transaction("scope", (transaction) => {
      transaction.appendOutbox(entry("one"));
    }));
    const acknowledged = await Effect.runPromise(store.transaction("scope", (transaction) => {
      transaction.acknowledgeOutbox("catalogWrite:one", 7, [change("one", row("one", "local"))]);
    }));
    expect(acknowledged.snapshot.outbox).toEqual([]);
    expect(acknowledged.snapshot.overlays).toHaveLength(1);
    expect(visibleRowsForStore(acknowledged.snapshot).category).toEqual([row("one", "local")]);

    const committed = await Effect.runPromise(store.transaction("scope", (transaction) => {
      transaction.commitPull(7, [change("one", row("one", "server"))], 7);
    }));
    expect(committed.snapshot.overlays).toEqual([]);
    expect(committed.snapshot.rows.category).toEqual([row("one", "server")]);
  });

  it("preserves a staged bootstrap until its final page is activated", async () => {
    const store = makeMemoryReplicaStore();
    const bootstrap = {
      id: "bootstrap",
      generation: "generation",
      cursor: 11,
      offset: 0,
      done: false,
      expiresAt: 100,
    };
    await Effect.runPromise(store.transaction("scope", (transaction) => {
      transaction.beginBootstrap(bootstrap);
      transaction.stageBootstrapPage("generation", [change("one", row("one", "server"))], 1, true);
    }));
    const active = await Effect.runPromise(store.transaction("scope", (transaction) => {
      transaction.activateBootstrap("generation");
    }));
    expect(active.snapshot.cursor).toBe(11);
    expect(active.snapshot.bootstrap).toBeUndefined();
    expect(active.snapshot.rows.category).toEqual([row("one", "server")]);
  });
});
