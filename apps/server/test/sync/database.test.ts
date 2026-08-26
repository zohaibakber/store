/** Compat until retirement: Durable Object / `/api/sync/live` WebSocket engine. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as LibsqlClient from "@effect/sql-libsql/LibsqlClient";
import { assert, describe, it } from "@effect/vitest";
import { SyncEntityChange, SyncOperation, SyncRequest } from "@store/contracts";
import { operationPayloadHash } from "@store/contracts/operation-hash";
import { durableObjectRelations } from "@store/db/do/relations";
import { categories, syncChangeLog, syncInbox } from "@store/db/do/schema";
import * as LibsqlDrizzle from "drizzle-orm/effect-libsql";
import { migrate } from "drizzle-orm/effect-libsql/migrator";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { makeDatabase } from "../../src/sync/database";
import type { SyncActor } from "../../src/sync/model";

const durableObjectMigrationsFolder = path.resolve(
  import.meta.dirname,
  "../../../../packages/db/migrations/do",
);

const makeTestDrizzle = () => LibsqlDrizzle.makeWithDefaults({ relations: durableObjectRelations });
type TestDrizzle = Effect.Success<ReturnType<typeof makeTestDrizzle>>;

interface Fixture {
  readonly database: TestDrizzle;
  readonly exchange: ReturnType<typeof makeDatabase>["exchange"];
}

const withDatabase = <A, E, R>(use: (fixture: Fixture) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.promise(() => mkdtemp(path.join(tmpdir(), "store-sync-server-"))).pipe(Effect.orDie),
    (directory) =>
      Effect.gen(function* () {
        const database = yield* makeTestDrizzle();
        yield* migrate(database, {
          migrationsFolder: durableObjectMigrationsFolder,
          migrationsTable: "__store_drizzle_migrations",
        });
        const service = makeDatabase(database);
        return yield* use({ database, exchange: service.exchange });
      }).pipe(
        Effect.provide(
          LibsqlClient.layer({ url: `file:${path.join(directory, "sync.db")}`, intMode: "number" }),
        ),
      ),
    (directory) =>
      Effect.promise(() => rm(directory, { recursive: true, force: true })).pipe(Effect.orDie),
  );

const actor: SyncActor = { organizationId: "org-1", userId: "user-1" };

const operationFor = (input: {
  readonly operationId: string;
  readonly actor?: SyncActor;
  readonly deviceId: string;
  readonly clientSequence: number;
  readonly occurredAt: number;
  readonly changes: ReadonlyArray<SyncEntityChange>;
}) => {
  const identity = input.actor ?? actor;
  const unhashed = SyncOperation.make({
    operationId: input.operationId,
    organizationId: identity.organizationId,
    deviceId: input.deviceId,
    actorUserId: identity.userId,
    clientSequence: input.clientSequence,
    occurredAt: input.occurredAt,
    payloadHash: "",
    changes: input.changes,
  });
  return SyncOperation.make({
    operationId: unhashed.operationId,
    organizationId: unhashed.organizationId,
    deviceId: unhashed.deviceId,
    actorUserId: unhashed.actorUserId,
    clientSequence: unhashed.clientSequence,
    occurredAt: unhashed.occurredAt,
    payloadHash: operationPayloadHash(unhashed),
    changes: unhashed.changes,
  });
};

const requestFor = (
  operation: SyncOperation,
  cursor = 0,
  identity: SyncActor = actor,
): SyncRequest =>
  SyncRequest.make({
    organizationId: identity.organizationId,
    deviceId: operation.deviceId,
    cursor,
    operations: [operation],
  });

const pullRequest = (cursor: number): SyncRequest =>
  SyncRequest.make({
    organizationId: actor.organizationId,
    deviceId: "pull-device",
    cursor,
    operations: [],
  });

const categoryChange = (id: string, name: string) =>
  SyncEntityChange.make({
    entity: "category",
    action: "upsert",
    entityId: id,
    rowVersion: 1,
    row: { id, name, tracksPacks: true },
  });

const productChange = (id: string, categoryId: string) =>
  SyncEntityChange.make({
    entity: "product",
    action: "upsert",
    entityId: id,
    rowVersion: 1,
    row: {
      id,
      name: "Test product",
      categoryId,
      aisle: null,
      composition: null,
      strength: null,
      unitsPerPack: 10,
      packPrice: 1_000,
      unitPrice: 100,
      visible: true,
    },
  });

const batchChange = (
  id: string,
  productId: string,
  input: {
    readonly batchNumber: string;
    readonly packQuantity: number;
    readonly unitQuantity: number;
    readonly rowVersion?: number;
  },
) =>
  SyncEntityChange.make({
    entity: "batch",
    action: "upsert",
    entityId: id,
    rowVersion: input.rowVersion ?? 1,
    row: {
      id,
      productId,
      batchNumber: input.batchNumber,
      expiresAt: null,
      packQuantity: input.packQuantity,
      unitQuantity: input.unitQuantity,
    },
  });

const movementChange = (
  id: string,
  productId: string,
  batchId: string,
  packDelta: number,
  unitDelta: number,
) =>
  SyncEntityChange.make({
    entity: "stockMovement",
    action: "upsert",
    entityId: id,
    rowVersion: 1,
    row: {
      id,
      productId,
      batchId,
      invoiceId: null,
      type: "stock_in",
      packDelta,
      unitDelta,
      note: null,
    },
  });

const invoiceChange = (id: string, invoiceNumber: number, total: number) =>
  SyncEntityChange.make({
    entity: "invoice",
    action: "upsert",
    entityId: id,
    rowVersion: 1,
    row: { id, invoiceNumber, customerName: null, total },
  });

const requireValue = <A>(value: A | undefined, message: string): A => {
  if (value === undefined) throw new Error(message);
  return value;
};

const BatchQuantities = Schema.Struct({
  packQuantity: Schema.Number,
  unitQuantity: Schema.Number,
});

describe("SyncDatabase with libSQL", () => {
  it.effect("applies a category operation and returns its canonical change", () =>
    withDatabase(({ exchange }) =>
      Effect.gen(function* () {
        const operation = operationFor({
          operationId: "operation-category",
          deviceId: "device-1",
          clientSequence: 1,
          occurredAt: 1_750_000_000_000,
          changes: [categoryChange("general", "General")],
        });

        const response = yield* exchange(actor, requestFor(operation));

        assert.strictEqual(response.acknowledgements[0]?.status, "applied");
        assert.isAbove(response.acknowledgements[0]?.cursor ?? 0, 0);
        assert.strictEqual(response.cursor, response.acknowledgements[0]?.cursor);
        assert.strictEqual(response.changes.length, 1);
        assert.deepInclude(response.changes[0]?.change, {
          entity: "category",
          entityId: "general",
          action: "upsert",
        });
      }),
    ),
  );

  it.effect("treats an identical operation replay as a duplicate without adding rows", () =>
    withDatabase(({ database, exchange }) =>
      Effect.gen(function* () {
        const operation = operationFor({
          operationId: "operation-replay",
          deviceId: "device-1",
          clientSequence: 1,
          occurredAt: 1_750_000_000_000,
          changes: [categoryChange("general", "General")],
        });
        const request = requestFor(operation);

        const first = yield* exchange(actor, request);
        const second = yield* exchange(actor, request);
        const categoryRows = yield* database.select().from(categories);
        const inboxRows = yield* database.select().from(syncInbox);
        const changeRows = yield* database.select().from(syncChangeLog);

        assert.strictEqual(first.acknowledgements[0]?.status, "applied");
        assert.strictEqual(second.acknowledgements[0]?.status, "duplicate");
        assert.strictEqual(second.acknowledgements[0]?.cursor, first.acknowledgements[0]?.cursor);
        assert.strictEqual(categoryRows.length, 1);
        assert.strictEqual(inboxRows.length, 1);
        assert.strictEqual(changeRows.length, 1);
      }),
    ),
  );

  it.effect("reconciles batch quantities from stock movements before logging the batch", () =>
    withDatabase(({ database, exchange }) =>
      Effect.gen(function* () {
        const operation = operationFor({
          operationId: "operation-inventory",
          deviceId: "device-1",
          clientSequence: 1,
          occurredAt: 1_750_000_000_000,
          changes: [
            categoryChange("general", "General"),
            productChange("product-1", "general"),
            batchChange("batch-1", "product-1", {
              batchNumber: "RAW-QUANTITIES",
              packQuantity: 99,
              unitQuantity: 99,
            }),
            movementChange("movement-1", "product-1", "batch-1", 3, 4),
            movementChange("movement-2", "product-1", "batch-1", -1, 2),
          ],
        });

        const response = yield* exchange(actor, requestFor(operation));
        const stored = yield* database.query.batches.findFirst({
          where: { organizationId: actor.organizationId, id: "batch-1" },
        });
        const canonical = requireValue(
          response.changes.find((entry) => entry.change.entity === "batch"),
          "Expected a canonical batch change",
        );
        const loggedQuantities = yield* Schema.decodeUnknownEffect(BatchQuantities)(
          canonical.change.row,
        );

        assert.strictEqual(stored?.packQuantity, 2);
        assert.strictEqual(stored?.unitQuantity, 6);
        assert.strictEqual(stored?.rowVersion, 2);
        assert.deepStrictEqual(loggedQuantities, { packQuantity: 2, unitQuantity: 6 });
      }),
    ),
  );

  it.effect("keeps ledger-derived quantities while the last concurrent batch update wins", () =>
    withDatabase(({ database, exchange }) =>
      Effect.gen(function* () {
        const seed = operationFor({
          operationId: "operation-seed",
          deviceId: "device-seed",
          clientSequence: 1,
          occurredAt: 1_750_000_000_000,
          changes: [
            categoryChange("general", "General"),
            productChange("product-1", "general"),
            batchChange("batch-1", "product-1", {
              batchNumber: "SEED",
              packQuantity: 5,
              unitQuantity: 2,
            }),
            movementChange("movement-1", "product-1", "batch-1", 5, 2),
          ],
        });
        yield* exchange(actor, requestFor(seed));

        const updateA = operationFor({
          operationId: "operation-update-a",
          deviceId: "device-a",
          clientSequence: 1,
          occurredAt: 1_750_000_000_100,
          changes: [
            batchChange("batch-1", "product-1", {
              batchNumber: "UPDATE-A",
              packQuantity: 100,
              unitQuantity: 100,
              rowVersion: 2,
            }),
          ],
        });
        const updateB = operationFor({
          operationId: "operation-update-b",
          deviceId: "device-b",
          clientSequence: 1,
          occurredAt: 1_750_000_000_200,
          changes: [
            batchChange("batch-1", "product-1", {
              batchNumber: "UPDATE-B",
              packQuantity: 200,
              unitQuantity: 200,
              rowVersion: 2,
            }),
          ],
        });

        yield* exchange(actor, requestFor(updateA));
        yield* exchange(actor, requestFor(updateB));
        const stored = yield* database.query.batches.findFirst({
          where: { organizationId: actor.organizationId, id: "batch-1" },
        });

        assert.strictEqual(stored?.batchNumber, "UPDATE-B");
        assert.strictEqual(stored?.packQuantity, 5);
        assert.strictEqual(stored?.unitQuantity, 2);
        assert.strictEqual(stored?.deviceId, "device-b");
        assert.strictEqual(stored?.operationId, "operation-update-b");
        assert.strictEqual(stored?.rowVersion, 6);
      }),
    ),
  );

  it.effect("advances the invoice counter to the highest invoice number applied", () =>
    withDatabase(({ database, exchange }) =>
      Effect.gen(function* () {
        const first = operationFor({
          operationId: "operation-invoice-1",
          deviceId: "device-1",
          clientSequence: 1,
          occurredAt: 1_750_000_000_000,
          changes: [invoiceChange("invoice-1", 1, 500)],
        });
        const higher = operationFor({
          operationId: "operation-invoice-2",
          deviceId: "device-1",
          clientSequence: 2,
          occurredAt: 1_750_000_000_100,
          changes: [invoiceChange("invoice-2", 7, 700)],
        });
        const lower = operationFor({
          operationId: "operation-invoice-3",
          deviceId: "device-2",
          clientSequence: 1,
          occurredAt: 1_750_000_000_200,
          changes: [invoiceChange("invoice-3", 3, 300)],
        });

        yield* exchange(actor, requestFor(first));
        yield* exchange(actor, requestFor(higher));
        yield* exchange(actor, requestFor(lower));
        const counter = yield* database.query.invoiceCounters.findFirst({
          where: { organizationId: actor.organizationId },
        });

        assert.strictEqual(counter?.lastInvoiceNumber, 7);
      }),
    ),
  );

  it.effect("pulls changes in cursor order and returns an empty terminal page", () =>
    withDatabase(({ exchange }) =>
      Effect.gen(function* () {
        const operation = operationFor({
          operationId: "operation-pull",
          deviceId: "device-1",
          clientSequence: 1,
          occurredAt: 1_750_000_000_000,
          changes: [
            categoryChange("category-c", "Category C"),
            categoryChange("category-a", "Category A"),
            categoryChange("category-b", "Category B"),
          ],
        });

        const first = yield* exchange(actor, requestFor(operation));
        const cursors = first.changes.map((entry) => entry.cursor);
        const terminal = yield* exchange(actor, pullRequest(first.cursor));

        assert.deepStrictEqual(
          cursors,
          [...cursors].sort((left, right) => left - right),
        );
        assert.isTrue(
          cursors.every((cursor, index) => {
            const previous = cursors[index - 1];
            return previous === undefined || cursor > previous;
          }),
        );
        assert.deepStrictEqual(terminal.changes, []);
        assert.isFalse(terminal.hasMore);
        assert.strictEqual(terminal.cursor, first.cursor);
      }),
    ),
  );
});

describe("stock movement immutability", () => {
  const protocolCodeOf = (failure: { readonly _tag: string; readonly code?: string }) => {
    if (failure._tag !== "SyncProtocolError")
      throw new Error(`Expected a protocol error, got ${failure._tag}`);
    return failure.code;
  };

  const seedOperation = operationFor({
    operationId: "operation-seed",
    deviceId: "device-1",
    clientSequence: 1,
    occurredAt: 1_750_000_000_000,
    changes: [
      categoryChange("category-1", "Category"),
      productChange("product-1", "category-1"),
      batchChange("batch-1", "product-1", {
        batchNumber: "B1",
        packQuantity: 10,
        unitQuantity: 0,
      }),
      movementChange("movement-1", "product-1", "batch-1", 10, 0),
    ],
  });

  it.effect("reusing a movement id from another operation is rejected", () =>
    withDatabase(({ exchange }) =>
      Effect.gen(function* () {
        yield* exchange(actor, requestFor(seedOperation));
        const replay = operationFor({
          operationId: "operation-replay",
          deviceId: "device-1",
          clientSequence: 2,
          occurredAt: 1_750_000_000_001,
          changes: [movementChange("movement-1", "product-1", "batch-1", 10, 0)],
        });

        const failure = yield* exchange(actor, requestFor(replay)).pipe(Effect.flip);

        assert.strictEqual(protocolCodeOf(failure), "IMMUTABLE_ENTITY_REUSED");
      }),
    ),
  );

  it.effect("reusing a movement id with different content is rejected", () =>
    withDatabase(({ exchange }) =>
      Effect.gen(function* () {
        yield* exchange(actor, requestFor(seedOperation));
        const rewrite = operationFor({
          operationId: "operation-rewrite",
          deviceId: "device-1",
          clientSequence: 2,
          occurredAt: 1_750_000_000_001,
          changes: [movementChange("movement-1", "product-1", "batch-1", 99, 5)],
        });

        const failure = yield* exchange(actor, requestFor(rewrite)).pipe(Effect.flip);

        assert.strictEqual(protocolCodeOf(failure), "IMMUTABLE_ENTITY_REUSED");
      }),
    ),
  );
});
