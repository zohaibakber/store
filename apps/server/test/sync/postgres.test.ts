import * as PgClient from "@effect/sql-pg/PgClient";
import { SYNC_PAGE_ROWS, type SyncEntityChange } from "@store/contracts";
import {
  catalogBootstraps,
  catalogNotificationOutbox,
  categories,
} from "@store/db/postgres/schema";
import { and, eq } from "drizzle-orm";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import { describe, expect, it } from "vitest";

import { bootstrapCatalog } from "../../src/inventory/bootstrap";
import { appendCatalogChanges, pullCatalogChanges } from "../../src/inventory/catalog-log";
import { withCatalogTransaction } from "../../src/inventory/catalog-transaction";
import { makePostgresDrizzle } from "../../src/inventory/postgres";

const url = process.env.STORE_SYNC_TEST_DATABASE_URL;
const run = <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(PgClient.layer({ url: Redacted.make(url ?? ""), maxConnections: 4 })),
    ),
  );
const change = (id: string): SyncEntityChange => ({
  entity: "category",
  entityId: id,
  action: "upsert",
  rowVersion: 1,
  row: { id, rowVersion: 1 },
});

describe.skipIf(!url)("Postgres sync protocol", () => {
  it("retains multi-page transaction boundaries and a durable notification", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makePostgresDrizzle(yield* PgClient.PgClient);
        const organizationId = crypto.randomUUID();
        const changes = Array.from({ length: SYNC_PAGE_ROWS + 1 }, (_, index) =>
          change(`row-${index}`),
        );
        const end = yield* withCatalogTransaction(db, organizationId, (tx) =>
          appendCatalogChanges(tx, organizationId, changes, Date.now()),
        );
        const first = yield* pullCatalogChanges(db, organizationId, {
          epoch: 2,
          cursor: 0,
          slices: ["catalog", "sales"],
        });
        expect(first.changes).toHaveLength(SYNC_PAGE_ROWS);
        expect(first.hasMore).toBe(true);
        expect("transactionEnd" in first && first.transactionEnd).toBe(end);
        expect(first.cursor).toBeLessThan(end);
        const last = yield* pullCatalogChanges(db, organizationId, {
          epoch: 2,
          cursor: first.cursor,
          slices: ["catalog", "sales"],
        });
        expect(last.changes).toHaveLength(1);
        expect(last.cursor).toBe(end);
        expect(last.hasMore).toBe(false);
        expect(
          (yield* db
            .select()
            .from(catalogNotificationOutbox)
            .where(eq(catalogNotificationOutbox.organizationId, organizationId)))[0]?.cursor,
        ).toBe(end);
      }),
    );
  });

  it("does not expose a later same-organization commit before an earlier transaction", async () => {
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const db = yield* makePostgresDrizzle(yield* PgClient.PgClient);
          const organizationId = crypto.randomUUID();
          const appended = yield* Deferred.make<number>();
          const release = yield* Deferred.make<void>();
          const first = yield* withCatalogTransaction(db, organizationId, (tx) =>
            Effect.gen(function* () {
              const cursor = yield* appendCatalogChanges(
                tx,
                organizationId,
                [change("first")],
                Date.now(),
              );
              yield* Deferred.succeed(appended, cursor);
              yield* Deferred.await(release);
              return cursor;
            }),
          ).pipe(Effect.forkScoped);
          const firstCursor = yield* Deferred.await(appended);
          const second = yield* withCatalogTransaction(db, organizationId, (tx) =>
            appendCatalogChanges(tx, organizationId, [change("second")], Date.now()),
          ).pipe(Effect.forkScoped);
          const before = yield* pullCatalogChanges(db, organizationId, {
            epoch: 2,
            cursor: 0,
            slices: ["catalog"],
          });
          expect(before.changes).toEqual([]);
          yield* withCatalogTransaction(db, crypto.randomUUID(), (tx) =>
            appendCatalogChanges(tx, "unrelated", [change("third")], Date.now()),
          );
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(first);
          expect(yield* Fiber.join(second)).toBeGreaterThan(firstCursor);
          const after = yield* pullCatalogChanges(db, organizationId, {
            epoch: 2,
            cursor: 0,
            slices: ["catalog"],
          });
          expect(after.changes.map((row) => row.entityId)).toEqual(["first", "second"]);
        }),
      ),
    );
  });

  it("resumes an immutable snapshot, isolates tenants, and rejects expired sessions", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makePostgresDrizzle(yield* PgClient.PgClient);
        const organizationId = crypto.randomUUID();
        const rows = Array.from({ length: SYNC_PAGE_ROWS + 1 }, (_, index) => ({
          id: `category-${index}`,
          name: `Category ${index}`,
          tracksPacks: true,
          organizationId,
          createdAt: 1,
          updatedAt: 1,
          createdByUserId: "user",
          updatedByUserId: "user",
          deviceId: "device",
          operationId: `op-${index}`,
          rowVersion: 1,
        }));
        yield* db.insert(categories).values(rows);
        const first = yield* bootstrapCatalog(db, organizationId, {
          epoch: 2,
          slices: ["catalog", "sales"],
        });
        expect(first.changes).toHaveLength(SYNC_PAGE_ROWS);
        expect(first.changes[0]?.row).toMatchObject({
          createdAt: 1,
          organizationId,
          tracksPacks: true,
        });
        const bootstrap = "bootstrap" in first ? first.bootstrap : undefined;
        if (!bootstrap) throw new Error("Snapshot did not return a bootstrap session");
        expect(bootstrap.done).toBe(false);
        yield* db
          .update(categories)
          .set({ name: "Changed after snapshot" })
          .where(
            and(
              eq(categories.organizationId, organizationId),
              eq(categories.id, `category-${SYNC_PAGE_ROWS}`),
            ),
          );
        const request = {
          epoch: 2,
          slices: ["catalog", "sales"] as const,
          bootstrap: { id: bootstrap.id, offset: bootstrap.nextOffset },
        };
        const last = yield* bootstrapCatalog(db, organizationId, request);
        expect(last.changes).toHaveLength(1);
        expect(last.changes[0]?.row).not.toMatchObject({ name: "Changed after snapshot" });
        expect("bootstrap" in last && last.bootstrap.done).toBe(true);
        expect(yield* bootstrapCatalog(db, "different-tenant", request)).toMatchObject({
          resetRequired: true,
        });
        yield* db
          .update(catalogBootstraps)
          .set({ expiresAt: 0 })
          .where(eq(catalogBootstraps.id, bootstrap.id));
        expect(yield* bootstrapCatalog(db, organizationId, request)).toMatchObject({
          resetRequired: true,
        });
      }),
    );
  });
});
