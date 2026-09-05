import type { CatalogWriteCommand } from "@store/contracts";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vitest";

import {
  CatalogError,
  CatalogTransport,
  ReplicaStore,
  makeMemoryReplicaStore,
  makeCatalog,
  replicaScopeKey,
  type ReplicaSnapshot,
} from "../src";

const scope = {
  organizationId: "org-1",
  deviceId: "device-1",
  apiOrigin: "https://inventory.example",
};

const category = (id: string, operationId: string) => ({
  id,
  name: `Category ${id}`,
  tracksPacks: true,
  organizationId: scope.organizationId,
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
  deviceId: scope.deviceId,
  operationId,
  rowVersion: 1,
  createdAt: 100,
  updatedAt: 100,
  deletedAt: null,
});

const command = (id: string): CatalogWriteCommand => ({
  operationId: `operation-${id}`,
  organizationId: scope.organizationId,
  deviceId: scope.deviceId,
  actorUserId: "user-1",
  occurredAt: 100,
  entity: "category",
  rows: [category(id, `operation-${id}`)],
});

const makeStore = (seed: Readonly<Record<string, ReplicaSnapshot>> = {}) => {
  const service = makeMemoryReplicaStore(seed);
  return { service, layer: Layer.succeed(ReplicaStore, service) };
};

const transportLayer = (
  write: (input: CatalogWriteCommand) => Effect.Effect<{ readonly txid: number }, CatalogError>,
) =>
  Layer.succeed(
    CatalogTransport,
    CatalogTransport.of({
      pull: () => Effect.never,
      snapshot: () => Effect.never,
      live: Stream.never,
      batch: (commands) =>
        Effect.forEach(commands, (entry) => {
          if (entry.kind !== "catalogWrite") return Effect.die("Unexpected command");
          return write(entry.command).pipe(
            Effect.map(({ txid }) => ({
              status: "accepted" as const,
              id: entry.command.operationId,
              txid,
            })),
          );
        }).pipe(Effect.map((results) => ({ results }))),
    }),
  );

describe("catalog engine", () => {
  it("keeps a write queued when it is added during an in-flight push", async () => {
    const pushed: Array<string> = [];

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const firstStarted = yield* Deferred.make<void>();
          const releaseFirst = yield* Deferred.make<void>();
          const store = makeStore();
          const catalog = yield* makeCatalog(scope).pipe(
            Effect.provide(store.layer),
            Effect.provide(
              transportLayer((input) =>
                Effect.gen(function* () {
                  pushed.push(input.operationId);
                  if (input.operationId === "operation-one") {
                    yield* Deferred.succeed(firstStarted, undefined);
                    yield* Deferred.await(releaseFirst);
                  }
                  return { txid: pushed.length };
                }),
              ),
            ),
          );

          yield* catalog.write(command("one"));
          yield* Deferred.await(firstStarted);
          yield* catalog.write(command("two"));

          const queued = yield* catalog.snapshot;
          expect(queued.outbox.map((entry) => entry.id)).toEqual([
            "operation-one",
            "operation-two",
          ]);
          expect(queued.rows.category).toHaveLength(2);

          yield* Deferred.succeed(releaseFirst, undefined);
          yield* catalog.waitForIdle;

          expect(pushed).toEqual(["operation-one", "operation-two"]);
          expect((yield* catalog.snapshot).outbox).toEqual([]);
        }),
      ),
    );
  });

  it("drains every restored outbox entry from one startup wake-up", async () => {
    const first = command("one");
    const second = command("two");
    const state: ReplicaSnapshot = {
      cursor: 1,
      rows: {
        category: [],
        product: [],
        batch: [],
        invoice: [],
        invoiceItem: [],
        stockMovement: [],
      },
      outbox: [
        { id: first.operationId, lane: "catalog", kind: "catalogWrite", command: first },
        { id: second.operationId, lane: "catalog", kind: "catalogWrite", command: second },
      ],
    };
    const stateKey = replicaScopeKey(scope.apiOrigin, scope.organizationId);
    const store = makeStore({ [stateKey]: state });
    const pushed: Array<string> = [];

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const catalog = yield* makeCatalog(scope).pipe(
            Effect.provide(store.layer),
            Effect.provide(
              transportLayer((input) =>
                Effect.sync(() => {
                  pushed.push(input.operationId);
                  return { txid: pushed.length };
                }),
              ),
            ),
          );

          yield* catalog.waitForIdle;
          expect(pushed).toEqual(["operation-one", "operation-two"]);
          expect((yield* catalog.snapshot).outbox).toEqual([]);

          const persisted = yield* store.service.load(stateKey);
          expect(persisted.outbox).toEqual([]);
        }),
      ),
    );
  });

  it("retries a transient push without waiting for another write", async () => {
    let attempts = 0;

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = makeStore();
          const catalog = yield* makeCatalog(scope).pipe(
            Effect.provide(store.layer),
            Effect.provide(
              transportLayer(() =>
                Effect.gen(function* () {
                  attempts += 1;
                  if (attempts === 1) {
                    return yield* new CatalogError({
                      reason: "transport",
                      message: "offline",
                    });
                  }
                  return { txid: 1 };
                }),
              ),
            ),
          );

          yield* catalog.write(command("retry"));
          const drained = yield* catalog.snapshot.pipe(
            Effect.repeat({
              until: (state) => state.outbox.length === 0,
              schedule: Schedule.spaced(Duration.millis(10)),
            }),
          );

          expect(drained.outbox).toEqual([]);
          expect(attempts).toBe(2);
        }),
      ),
    );
  });
});
