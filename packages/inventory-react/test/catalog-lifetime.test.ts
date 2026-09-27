import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect, it } from "vitest";

import { CatalogOpenFailure, StaleCatalogLease } from "../src/errors";
import type { InventoryHost } from "../src/host";
import { createCatalogLifetime } from "../src/lifetime";

const host: InventoryHost = {
  apiBaseUrl: "http://localhost",
  deviceId: "device",
  openReplica: async () => {
    throw new Error("unused");
  },
};

const scope = { organizationId: "o1", userId: "u1" };

const hanging = new Promise<void>(() => undefined);

const runTest = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestClock.layer())));

const signal = (deferred: Deferred.Deferred<void>) => {
  Deferred.doneUnsafe(deferred, Exit.void);
};

describe("catalog lifetime", () => {
  it("returns from release while the retired replica is still disposing", () =>
    runTest(
      Effect.gen(function* () {
        const disposing = yield* Deferred.make<void>();
        const catalog = createCatalogLifetime({
          open: async () => ({
            dispose: () => {
              signal(disposing);
              return hanging;
            },
          }),
          databaseName: () => "org",
        });
        yield* catalog.open(catalog.claim(scope), host);

        catalog.release();

        expect(catalog.lease()).toBeNull();
        yield* Deferred.await(disposing);
      }),
    ));

  it("opens the next lease after a hung dispose once the same-file wait elapses", () =>
    runTest(
      Effect.gen(function* () {
        const disposing = yield* Deferred.make<void>();
        let opens = 0;
        const catalog = createCatalogLifetime({
          open: async () => {
            opens += 1;
            return {
              dispose: () => {
                signal(disposing);
                return hanging;
              },
            };
          },
          databaseName: () => "org",
          sameFileWaitMs: 20,
        });

        yield* catalog.open(catalog.claim(scope), host);
        catalog.release();
        yield* Deferred.await(disposing);
        const second = catalog.claim(scope);
        const opening = yield* Effect.forkChild(catalog.open(second, host));
        yield* Effect.yieldNow;
        expect(opening.pollUnsafe()).toBeUndefined();

        yield* TestClock.adjust("20 millis");
        yield* Fiber.join(opening);

        expect(opens).toBe(2);
        expect(catalog.lease()).toBe(second);
      }),
    ));

  it("fails open for a lease superseded by a newer claim", () =>
    runTest(
      Effect.gen(function* () {
        const catalog = createCatalogLifetime({
          open: async () => ({ dispose: async () => undefined }),
          databaseName: () => "org",
        });
        const stale = catalog.claim(scope);
        catalog.claim(scope);

        const failure = yield* Effect.flip(catalog.open(stale, host));

        expect(failure).toBeInstanceOf(StaleCatalogLease);
      }),
    ));

  it("interrupts an in-flight open when its lease is released and disposes what it opened", () =>
    runTest(
      Effect.gen(function* () {
        const opened = yield* Deferred.make<{ readonly dispose: () => Promise<void> }>();
        const disposed = yield* Deferred.make<void>();
        const catalog = createCatalogLifetime({
          open: () => Effect.runPromise(Deferred.await(opened)),
          databaseName: () => "org",
        });
        const opening = yield* Effect.forkChild(catalog.open(catalog.claim(scope), host));
        yield* Effect.yieldNow;

        catalog.release();
        yield* Deferred.succeed(opened, {
          dispose: async () => {
            signal(disposed);
          },
        });

        const failure = yield* Effect.flip(Fiber.join(opening));
        expect(failure).toBeInstanceOf(StaleCatalogLease);
        yield* Deferred.await(disposed);
      }),
    ));

  it("coalesces repeated opens for the same lease and disposes once on release", () =>
    runTest(
      Effect.gen(function* () {
        const disposed = yield* Deferred.make<void>();
        let opens = 0;
        let disposals = 0;
        const catalog = createCatalogLifetime({
          open: async () => {
            opens += 1;
            return {
              dispose: async () => {
                disposals += 1;
                signal(disposed);
              },
            };
          },
          databaseName: () => "org",
        });
        const lease = catalog.claim(scope);

        const [first, second] = yield* Effect.all(
          [catalog.open(lease, host), catalog.open(lease, host)],
          { concurrency: "unbounded" },
        );
        const third = yield* catalog.open(lease, host);

        expect(first).toBe(second);
        expect(second).toBe(third);
        expect(opens).toBe(1);
        catalog.release();
        yield* Deferred.await(disposed);
        expect(disposals).toBe(1);
      }),
    ));

  it("retries a failed open on the same lease instead of caching the failure", () =>
    runTest(
      Effect.gen(function* () {
        let opens = 0;
        const catalog = createCatalogLifetime({
          open: async () => {
            opens += 1;
            if (opens === 1) throw new Error("storage locked");
            return { dispose: async () => undefined };
          },
          databaseName: () => "org",
        });
        const lease = catalog.claim(scope);

        const failure = yield* Effect.flip(catalog.open(lease, host));
        yield* catalog.open(lease, host);

        expect(failure).toBeInstanceOf(CatalogOpenFailure);
        expect(failure.message).toBe("storage locked");
        expect(opens).toBe(2);
      }),
    ));
});
