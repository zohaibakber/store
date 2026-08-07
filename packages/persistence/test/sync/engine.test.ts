import * as LibsqlClient from "@effect/sql-libsql/LibsqlClient";
import {
  SyncEntityChange,
  SyncResponse,
  SyncServerChange,
  type SyncRequest,
} from "@store/contracts";
import { invoices, products, syncOutbox } from "@store/db/local/schema";
import * as LibsqlDrizzle from "drizzle-orm/effect-libsql";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { expect, test } from "vitest";

import { databaseFile } from "../../src/database/client";
import { SyncTransportError } from "../../src/index";
import { QUARANTINE_ATTEMPTS, remoteChangeWins, retryDelayMillis } from "../../src/sync/engine";
import { readOutbox, store, type TestStoreRuntime, withTestStore } from "../lib/store";

const setOutboxNextAttemptAt = (dataDir: string, nextAttemptAt: number | null) =>
  Effect.gen(function* () {
    const database = yield* LibsqlDrizzle.makeWithDefaults();
    yield* database.update(syncOutbox).set({ nextAttemptAt });
  }).pipe(
    Effect.provide(LibsqlClient.layer({ url: `file:${databaseFile(dataDir)}`, intMode: "number" })),
    Effect.runPromise,
  );

const responseFor = (request: SyncRequest): SyncResponse => ({
  protocolVersion: 2,
  organizationId: request.organizationId,
  cursor: request.cursor,
  nextCursor: request.cursor,
  headCursor: request.cursor,
  hasMore: false,
  acknowledgements: request.operations.map((operation) => ({
    operationId: operation.operationId,
    status: "applied",
    cursor: request.cursor,
  })),
  changes: [],
});

const ProductRow = createSelectSchema(products);
type ProductRow = typeof ProductRow.Type;

const seedProduct = async (runtime: TestStoreRuntime, rowVersion: 1 | 3) => {
  let product = await runtime.runPromise(
    store((store) =>
      store.createProduct({
        name: "Local product v1",
        categoryId: "general",
        aisle: "A1",
        composition: "Test composition",
        strength: "100mg",
        unitsPerPack: 10,
        packPrice: 1_000,
        unitPrice: 100,
      }),
    ),
  );
  for (let version = 2; version <= rowVersion; version += 1) {
    product = await runtime.runPromise(
      store((store) =>
        store.updateProduct({
          id: product.id,
          name: `Local product v${version}`,
          categoryId: "general",
          aisle: "A1",
          composition: "Test composition",
          strength: "100mg",
          unitsPerPack: 10,
          packPrice: 1_000,
          unitPrice: 100,
        }),
      ),
    );
  }
  return product;
};

const capturedProductRow = async (dataDir: string, productId: string): Promise<ProductRow> => {
  const outbox = await readOutbox(dataDir);
  const changes = outbox
    .flatMap((operation) => operation.payload)
    .filter((change) => change.entity === "product" && change.entityId === productId);
  const latest = changes.at(-1);
  if (!latest) throw new Error(`No product change was captured for ${productId}`);
  return Schema.decodeUnknownSync(ProductRow)(latest.row);
};

const remoteProductChange = (input: {
  readonly cursor: number;
  readonly source: ProductRow;
  readonly id?: string;
  readonly name: string;
  readonly rowVersion: number;
}) => {
  const id = input.id ?? input.source.id;
  const operationId = `remote-operation-${input.cursor}`;
  return SyncServerChange.make({
    cursor: input.cursor,
    operationId,
    changedAt: input.source.updatedAt + input.cursor,
    change: SyncEntityChange.make({
      entity: "product",
      action: "upsert",
      entityId: id,
      rowVersion: input.rowVersion,
      row: {
        ...input.source,
        id,
        name: input.name,
        updatedAt: input.source.updatedAt + input.cursor,
        updatedByUserId: "remote-user",
        deviceId: "remote-device",
        operationId,
        rowVersion: input.rowVersion,
      },
    }),
  });
};

const InvoiceRow = createSelectSchema(invoices);
type InvoiceRow = typeof InvoiceRow.Type;

const capturedInvoiceRow = async (dataDir: string, invoiceId: string): Promise<InvoiceRow> => {
  const outbox = await readOutbox(dataDir);
  const captured = outbox
    .flatMap((operation) => operation.payload)
    .find((change) => change.entity === "invoice" && change.entityId === invoiceId);
  if (!captured) throw new Error(`No invoice change was captured for ${invoiceId}`);
  return Schema.decodeUnknownSync(InvoiceRow)(captured.row);
};

const remoteInvoiceChange = (input: {
  readonly cursor: number;
  readonly source: InvoiceRow;
  readonly id: string;
  readonly invoiceNumber: number;
}) => {
  const operationId = `remote-invoice-operation-${input.cursor}`;
  return SyncServerChange.make({
    cursor: input.cursor,
    operationId,
    changedAt: input.source.updatedAt + input.cursor,
    change: SyncEntityChange.make({
      entity: "invoice",
      action: "upsert",
      entityId: input.id,
      rowVersion: 1,
      row: {
        ...input.source,
        id: input.id,
        invoiceNumber: input.invoiceNumber,
        updatedAt: input.source.updatedAt + input.cursor,
        updatedByUserId: "remote-user",
        deviceId: "remote-device",
        operationId,
        rowVersion: 1,
      },
    }),
  });
};

const transportFor = (changes: ReadonlyArray<SyncServerChange>) => ({
  exchange: (request: SyncRequest) => {
    const page = changes.filter((change) => change.cursor > request.cursor);
    const cursor = page.reduce(
      (maximum, change) => Math.max(maximum, change.cursor),
      request.cursor,
    );
    return Effect.succeed(
      SyncResponse.make({
        protocolVersion: 2,
        organizationId: request.organizationId,
        cursor,
        nextCursor: cursor,
        headCursor: cursor,
        hasMore: false,
        acknowledgements: request.operations.map((operation) => ({
          operationId: operation.operationId,
          status: "applied",
          cursor,
        })),
        changes: page,
      }),
    );
  },
});

test("each business mutation commits one durable sync operation", async () => {
  await withTestStore(async ({ dataDir, runtime }) => {
    const product = await runtime.runPromise(
      store((store) =>
        store.createProduct({
          name: "Queued product",
          aisle: null,
          composition: null,
          strength: null,
          packPrice: null,
          unitPrice: 250,
        }),
      ),
    );
    await runtime.runPromise(
      store((store) =>
        store.createBatch({
          productId: product.id,
          batchNumber: "QUEUE-1",
          expiresAt: null,
          packQuantity: 1,
          unitQuantity: 2,
        }),
      ),
    );
    await runtime.dispose();

    const queued = await readOutbox(dataDir);
    expect(queued).toHaveLength(3);
    // The fixture's category is an ordinary mutation now that nothing is seeded.
    expect(queued[0]?.payload.map((change) => change.entity)).toEqual(["category"]);
    expect(queued[1]?.payload).toEqual([
      expect.objectContaining({ entity: "product", action: "upsert" }),
    ]);
    expect(queued[2]?.payload).toEqual([
      expect.objectContaining({ entity: "batch", action: "upsert" }),
      expect.objectContaining({ entity: "stockMovement", action: "upsert" }),
    ]);
    expect(queued.every((operation) => operation.payloadHash.length === 64)).toBe(true);
    expect(queued.every((operation) => operation.acknowledgedAt === null)).toBe(true);
  });
});

test("an offline transport never rolls back local writes and leaves outbox work pending", async () => {
  const transport = {
    exchange: () =>
      Effect.fail(SyncTransportError.make({ message: "network unavailable", retryable: true })),
  };
  await withTestStore(
    async ({ dataDir, runtime, makeRuntime }) => {
      const product = await runtime.runPromise(
        store((store) =>
          store.createProduct({
            name: "Offline write",
            aisle: null,
            composition: null,
            strength: null,
            packPrice: null,
            unitPrice: null,
          }),
        ),
      );
      await expect(runtime.runPromise(store((store) => store.sync))).rejects.toThrow(
        /network unavailable/,
      );
      expect(await runtime.runPromise(store((store) => store.getProduct(product.id)))).toEqual(
        product,
      );
      expect(await runtime.runPromise(store((store) => store.getSyncStatus))).toMatchObject({
        configured: true,
        phase: "error",
      });
      await runtime.dispose();

      const reopened = makeRuntime({ syncTransport: undefined });
      expect(await reopened.runPromise(store((store) => store.getProduct(product.id)))).toEqual(
        product,
      );

      const pending = await readOutbox(dataDir);
      expect(pending).toHaveLength(2);
      expect(pending.every((operation) => operation.acknowledgedAt === null)).toBe(true);
      expect(pending.every((operation) => operation.attemptCount > 0)).toBe(true);
    },
    { syncTransport: transport },
  );
});

test("a flaky transport is retried and the outbox drains", async () => {
  let attempts = 0;
  const transport = {
    exchange: (request: SyncRequest) => {
      attempts += 1;
      return attempts <= 2
        ? Effect.fail(
            SyncTransportError.make({
              message: "temporary network failure",
              retryable: true,
            }),
          )
        : Effect.succeed(responseFor(request));
    },
  };
  await withTestStore(
    async ({ dataDir, runtime }) => {
      await runtime.runPromise(
        store((store) =>
          store.createProduct({
            name: "Eventually synced",
            aisle: null,
            composition: null,
            strength: null,
            packPrice: null,
            unitPrice: null,
          }),
        ),
      );
      await expect(runtime.runPromise(store((store) => store.sync))).resolves.toMatchObject({
        phase: "idle",
      });
      expect(attempts).toBeGreaterThanOrEqual(3);
      await runtime.dispose();

      const outbox = await readOutbox(dataDir);
      expect(outbox).toEqual([]);
    },
    { syncTransport: transport },
  );
});

test("a permanently failing transport still fails after retries", async () => {
  let attempts = 0;
  const transport = {
    exchange: () => {
      attempts += 1;
      return Effect.fail(
        SyncTransportError.make({ message: "network unavailable", retryable: true }),
      );
    },
  };
  await withTestStore(
    async ({ dataDir, runtime }) => {
      await runtime.runPromise(
        store((store) =>
          store.createProduct({
            name: "Still pending",
            aisle: null,
            composition: null,
            strength: null,
            packPrice: null,
            unitPrice: null,
          }),
        ),
      );
      await expect(runtime.runPromise(store((store) => store.sync))).rejects.toMatchObject({
        _tag: "PersistenceError",
        operation: "exchange sync changes",
      });
      expect(attempts).toBeGreaterThanOrEqual(4);
      await runtime.dispose();

      const outbox = await readOutbox(dataDir);
      expect(outbox.length).toBeGreaterThan(0);
      expect(outbox.every((operation) => operation.acknowledgedAt === null)).toBe(true);
      expect(outbox[0]?.lastError).toBe("network unavailable");
      expect(outbox.slice(1).every((operation) => operation.lastError === null)).toBe(true);
    },
    { syncTransport: transport },
  );
});

test("a non-retryable transport error fails once with its protocol details", async () => {
  let attempts = 0;
  const transport = {
    exchange: () => {
      attempts += 1;
      return Effect.fail(
        SyncTransportError.make({
          message: "operations[0].changes must contain at most 1,000 items",
          retryable: false,
          status: 400,
          code: "INVALID_SYNC_REQUEST",
        }),
      );
    },
  };
  await withTestStore(
    async ({ runtime }) => {
      await expect(runtime.runPromise(store((store) => store.sync))).rejects.toMatchObject({
        _tag: "PersistenceError",
        operation: "exchange sync changes",
        message: expect.stringContaining("INVALID_SYNC_REQUEST"),
        cause: expect.objectContaining({
          _tag: "SyncTransportError",
          status: 400,
          retryable: false,
        }),
      });
      expect(attempts).toBe(1);
    },
    { syncTransport: transport },
  );
});

test("a remote product change creates a product that does not exist locally", async () => {
  await withTestStore(async ({ dataDir, runtime: seedRuntime, makeRuntime }) => {
    const template = await seedProduct(seedRuntime, 1);
    await seedRuntime.dispose();
    const source = await capturedProductRow(dataDir, template.id);
    const remoteId = "remote-product";
    const remote = remoteProductChange({
      cursor: 1,
      source,
      id: remoteId,
      name: "Remote product",
      rowVersion: 4,
    });
    const runtime = makeRuntime({ syncTransport: transportFor([remote]) });

    await expect(runtime.runPromise(store((store) => store.sync))).resolves.toMatchObject({
      phase: "idle",
    });
    const product = await runtime.runPromise(store((store) => store.getProduct(remoteId)));

    expect(product).toMatchObject({ id: remoteId, name: "Remote product", rowVersion: 4 });
    expect(await runtime.runPromise(store((store) => store.listProducts))).toHaveLength(2);
  });
});

test("a legacy remote category defaults its missing tracksPacks value", async () => {
  const operationId = "legacy-category-operation";
  const legacyCategory = SyncServerChange.make({
    cursor: 1,
    operationId,
    changedAt: 1_700_000_000_000,
    change: SyncEntityChange.make({
      entity: "category",
      action: "upsert",
      entityId: "legacy-category",
      rowVersion: 1,
      row: {
        id: "legacy-category",
        name: "Legacy category",
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        deletedAt: null,
        organizationId: "local",
        createdByUserId: "remote-user",
        updatedByUserId: "remote-user",
        deviceId: "remote-device",
        operationId,
        rowVersion: 1,
      },
    }),
  });
  await withTestStore(
    async ({ runtime }) => {
      const synced = runtime.runPromise(store((store) => store.sync));

      await expect(synced).resolves.toMatchObject({ phase: "idle" });
      await expect(runtime.runPromise(store((store) => store.listCategories))).resolves.toEqual([
        expect.objectContaining({
          id: "legacy-category",
          name: "Legacy category",
          tracksPacks: true,
        }),
      ]);
    },
    { categories: [], syncTransport: transportFor([legacyCategory]) },
  );
});

test("a stale remote product change is skipped", async () => {
  await withTestStore(async ({ dataDir, runtime: seedRuntime, makeRuntime }) => {
    const local = await seedProduct(seedRuntime, 3);
    await seedRuntime.dispose();
    const source = await capturedProductRow(dataDir, local.id);
    const stale = remoteProductChange({
      cursor: 1,
      source,
      name: "Stale remote name",
      rowVersion: 2,
    });
    const runtime = makeRuntime({ syncTransport: transportFor([stale]) });

    await expect(runtime.runPromise(store((store) => store.sync))).resolves.toMatchObject({
      phase: "idle",
    });
    const product = await runtime.runPromise(store((store) => store.getProduct(local.id)));

    expect(product.name).toBe("Local product v3");
    expect(product.rowVersion).toBe(3);
  });
});

test("a newer remote product change replaces the local row", async () => {
  await withTestStore(async ({ dataDir, runtime: seedRuntime, makeRuntime }) => {
    const local = await seedProduct(seedRuntime, 3);
    await seedRuntime.dispose();
    const source = await capturedProductRow(dataDir, local.id);
    const newer = remoteProductChange({
      cursor: 1,
      source,
      name: "Newer remote name",
      rowVersion: 4,
    });
    const runtime = makeRuntime({ syncTransport: transportFor([newer]) });

    await expect(runtime.runPromise(store((store) => store.sync))).resolves.toMatchObject({
      phase: "idle",
    });
    const product = await runtime.runPromise(store((store) => store.getProduct(local.id)));

    expect(product.name).toBe("Newer remote name");
    expect(product.rowVersion).toBe(4);
  });
});

// The local invoice already created the counter row, so the remote invoice
// takes the conflict branch — the path where a Postgres `greatest` would have
// thrown "no such function" against SQLite.
test("a remote invoice advances the local invoice counter past its own number", async () => {
  await withTestStore(async ({ dataDir, runtime: seedRuntime, makeRuntime }) => {
    const product = await seedRuntime.runPromise(
      store((store) =>
        store.createProduct({
          name: "Counter product",
          aisle: null,
          composition: null,
          strength: null,
          unitsPerPack: 1,
          packPrice: null,
          unitPrice: 100,
        }),
      ),
    );
    const batch = await seedRuntime.runPromise(
      store((store) =>
        store.createBatch({
          productId: product.id,
          batchNumber: null,
          expiresAt: null,
          packQuantity: 0,
          unitQuantity: 10,
        }),
      ),
    );
    const sale = {
      customerName: null,
      items: [
        {
          productId: product.id,
          batchId: batch.id,
          quantity: 1,
          quantityType: "unit" as const,
          salePrice: 100,
        },
      ],
    };
    const local = await seedRuntime.runPromise(store((store) => store.createInvoice(sale)));
    expect(local.invoiceNumber).toBe(1);
    await seedRuntime.dispose();

    const source = await capturedInvoiceRow(dataDir, local.id);
    const remote = remoteInvoiceChange({
      cursor: 1,
      source,
      id: "remote-invoice",
      invoiceNumber: 7,
    });
    const runtime = makeRuntime({ syncTransport: transportFor([remote]) });

    await expect(runtime.runPromise(store((store) => store.sync))).resolves.toMatchObject({
      phase: "idle",
    });

    // The counter is only observable through the number it hands out next.
    const next = await runtime.runPromise(store((store) => store.createInvoice(sale)));
    expect(next.invoiceNumber).toBe(8);
  });
});

test("retryDelayMillis grows with attemptCount and never exceeds the cap", () => {
  expect(retryDelayMillis(1)).toBe(1_000);
  expect(retryDelayMillis(2)).toBe(2_000);
  expect(retryDelayMillis(3)).toBe(4_000);
  expect(retryDelayMillis(4)).toBe(8_000);
  expect(retryDelayMillis(0)).toBe(1_000);
  expect(retryDelayMillis(-1)).toBe(1_000);
  expect(retryDelayMillis(30)).toBe(5 * 60 * 1_000);
  expect(retryDelayMillis(QUARANTINE_ATTEMPTS)).toBeLessThanOrEqual(5 * 60 * 1_000);
});

test("remoteChangeWins keeps a strictly newer local row and overwrites on a tie", () => {
  expect(remoteChangeWins(undefined, { rowVersion: 1 })).toBe(true);
  expect(remoteChangeWins({ rowVersion: 1 }, { rowVersion: 2 })).toBe(true);
  expect(remoteChangeWins({ rowVersion: 2 }, { rowVersion: 2 })).toBe(true);
  expect(remoteChangeWins({ rowVersion: 3 }, { rowVersion: 2 })).toBe(false);
});

test("a failed exchange sets a future nextAttemptAt and increments attemptCount", async () => {
  const transport = {
    exchange: () =>
      Effect.fail(SyncTransportError.make({ message: "network unavailable", retryable: true })),
  };
  await withTestStore(
    async ({ dataDir, runtime }) => {
      await runtime.runPromise(
        store((store) =>
          store.createProduct({
            name: "Backoff candidate",
            aisle: null,
            composition: null,
            strength: null,
            packPrice: null,
            unitPrice: null,
          }),
        ),
      );
      const before = Date.now();
      await expect(runtime.runPromise(store((store) => store.sync))).rejects.toMatchObject({
        _tag: "PersistenceError",
      });
      await runtime.dispose();

      const outbox = await readOutbox(dataDir);
      expect(outbox.length).toBeGreaterThan(0);
      expect(outbox[0]?.attemptCount).toBeGreaterThan(0);
      expect(outbox[0]?.nextAttemptAt).not.toBeNull();
      expect(outbox[0]?.nextAttemptAt as number).toBeGreaterThan(before);
      expect(outbox.slice(1).every((operation) => operation.nextAttemptAt === null)).toBe(true);
    },
    { syncTransport: transport },
  );
});

test("an operation that is not yet due is not resent", async () => {
  const requests: Array<SyncRequest> = [];
  let offline = true;
  const transport = {
    exchange: (request: SyncRequest) => {
      requests.push(request);
      return offline
        ? Effect.fail(SyncTransportError.make({ message: "network unavailable", retryable: true }))
        : Effect.succeed(responseFor(request));
    },
  };
  await withTestStore(
    async ({ dataDir, runtime }) => {
      await runtime.runPromise(
        store((store) =>
          store.createProduct({
            name: "Not yet due",
            aisle: null,
            composition: null,
            strength: null,
            packPrice: null,
            unitPrice: null,
          }),
        ),
      );
      await expect(runtime.runPromise(store((store) => store.sync))).rejects.toMatchObject({
        _tag: "PersistenceError",
      });
      const requestsAfterFirstFailure = requests.length;
      expect(requestsAfterFirstFailure).toBeGreaterThan(0);
      expect(requests[0]?.operations.length).toBeGreaterThan(0);

      await setOutboxNextAttemptAt(dataDir, Date.now() + 60_000);
      offline = false;
      await expect(runtime.runPromise(store((store) => store.sync))).resolves.toMatchObject({
        phase: "idle",
      });

      expect(requests.length).toBe(requestsAfterFirstFailure + 1);
      expect(requests.at(-1)?.operations).toEqual([]);

      const outbox = await readOutbox(dataDir);
      expect(outbox.every((operation) => operation.acknowledgedAt === null)).toBe(true);
    },
    { syncTransport: transport },
  );
});

test("status reports the stuck queue after a failure", async () => {
  const transport = {
    exchange: () =>
      Effect.fail(SyncTransportError.make({ message: "network unavailable", retryable: true })),
  };
  await withTestStore(
    async ({ dataDir, runtime }) => {
      await runtime.runPromise(
        store((store) =>
          store.createProduct({
            name: "Stuck status",
            aisle: null,
            composition: null,
            strength: null,
            packPrice: null,
            unitPrice: null,
          }),
        ),
      );
      await expect(runtime.runPromise(store((store) => store.sync))).rejects.toMatchObject({
        _tag: "PersistenceError",
      });

      const outbox = await readOutbox(dataDir);
      const status = await runtime.runPromise(store((store) => store.getSyncStatus));

      expect(status.pendingOperations).toBe(outbox.length);
      expect(status.oldestPendingAt).not.toBeNull();
      expect(status.lastError).toBe("network unavailable");
      expect(status.quarantined).toBe(false);
    },
    { syncTransport: transport },
  );
});

test("a subsequent successful exchange clears the backoff and status", async () => {
  let shouldFail = true;
  const transport = {
    exchange: (request: SyncRequest) => {
      if (shouldFail) {
        return Effect.fail(
          SyncTransportError.make({ message: "network unavailable", retryable: true }),
        );
      }
      return Effect.succeed(responseFor(request));
    },
  };
  await withTestStore(
    async ({ dataDir, runtime }) => {
      await runtime.runPromise(
        store((store) =>
          store.createProduct({
            name: "Recovers",
            aisle: null,
            composition: null,
            strength: null,
            packPrice: null,
            unitPrice: null,
          }),
        ),
      );
      await expect(runtime.runPromise(store((store) => store.sync))).rejects.toMatchObject({
        _tag: "PersistenceError",
      });

      shouldFail = false;
      await setOutboxNextAttemptAt(dataDir, null);
      const status = await runtime.runPromise(store((store) => store.sync));

      expect(status.phase).toBe("idle");
      expect(status.pendingOperations).toBe(0);
      expect(status.quarantined).toBe(false);

      const outbox = await readOutbox(dataDir);
      expect(outbox).toEqual([]);
    },
    { syncTransport: transport },
  );
});

test("out-of-order remote cursors reject and roll back every pulled row", async () => {
  await withTestStore(async ({ dataDir, runtime: seedRuntime, makeRuntime }) => {
    const template = await seedProduct(seedRuntime, 1);
    await seedRuntime.dispose();
    const source = await capturedProductRow(dataDir, template.id);
    const outOfOrder = [
      remoteProductChange({
        cursor: 2,
        source,
        id: "remote-product-a",
        name: "Remote product A",
        rowVersion: 2,
      }),
      remoteProductChange({
        cursor: 1,
        source,
        id: "remote-product-b",
        name: "Remote product B",
        rowVersion: 2,
      }),
    ];
    const runtime = makeRuntime({ syncTransport: transportFor(outOfOrder) });
    const countBefore = (await runtime.runPromise(store((store) => store.listProducts))).length;

    await expect(runtime.runPromise(store((store) => store.sync))).rejects.toMatchObject({
      _tag: "PersistenceError",
      operation: "apply sync response",
      message: "Remote changes are not in strict cursor order",
    });

    expect(await runtime.runPromise(store((store) => store.listProducts))).toHaveLength(
      countBefore,
    );
    await expect(
      runtime.runPromise(store((store) => store.getProduct("remote-product-a"))),
    ).rejects.toMatchObject({ _tag: "ProductNotFoundError" });
  });
});
