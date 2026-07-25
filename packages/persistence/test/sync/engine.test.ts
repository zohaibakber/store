import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as LibsqlClient from "@effect/sql-libsql/LibsqlClient";
import {
  SyncEntityChange,
  SyncResponse,
  SyncServerChange,
  type SyncRequest,
} from "@store/contracts";
import { products, syncOutbox } from "@store/db/local/schema";
import * as LibsqlDrizzle from "drizzle-orm/effect-libsql";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";
import { expect, test } from "vitest";

import { databaseFile } from "../../src/database/client";
import {
  layer,
  SyncTransportError,
  type OfflineStore,
  type PersistenceError,
} from "../../src/index";
import { QUARANTINE_ATTEMPTS, remoteChangeWins, retryDelayMillis } from "../../src/sync/engine";
import { migrationsFolder, readOutbox, store } from "../lib/store";

const setOutboxNextAttemptAt = (dataDir: string, nextAttemptAt: number | null) =>
  Effect.gen(function* () {
    const database = yield* LibsqlDrizzle.makeWithDefaults();
    yield* database.update(syncOutbox).set({ nextAttemptAt });
  }).pipe(
    Effect.provide(LibsqlClient.layer({ url: `file:${databaseFile(dataDir)}`, intMode: "number" })),
    Effect.runPromise,
  );

const responseFor = (request: SyncRequest): SyncResponse => ({
  organizationId: request.organizationId,
  cursor: request.cursor,
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

const seedProduct = async (dataDir: string, rowVersion: 1 | 3) => {
  const runtime = ManagedRuntime.make(layer({ dataDir, migrationsFolder }));
  try {
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
  } finally {
    await runtime.dispose();
  }
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

const transportFor = (changes: ReadonlyArray<SyncServerChange>) => ({
  exchange: (request: SyncRequest) => {
    const page = changes.filter((change) => change.cursor > request.cursor);
    const cursor = page.reduce(
      (maximum, change) => Math.max(maximum, change.cursor),
      request.cursor,
    );
    return Effect.succeed(
      SyncResponse.make({
        organizationId: request.organizationId,
        cursor,
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
  const directory = await mkdtemp(path.join(tmpdir(), "store-offline-"));
  const dataDir = path.join(directory, "data");
  const runtime = ManagedRuntime.make(layer({ dataDir, migrationsFolder }));

  try {
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
    expect(queued[0]?.operationId).toBe("bootstrap:local:categories:v1");
    expect(queued[0]?.payload.map((change) => change.entity)).toEqual([
      "category",
      "category",
      "category",
    ]);
    expect(queued[1]?.payload).toEqual([
      expect.objectContaining({ entity: "product", action: "upsert" }),
    ]);
    expect(queued[2]?.payload).toEqual([
      expect.objectContaining({ entity: "batch", action: "upsert" }),
      expect.objectContaining({ entity: "stockMovement", action: "upsert" }),
    ]);
    expect(queued.every((operation) => operation.payloadHash.length === 64)).toBe(true);
    expect(queued.every((operation) => operation.acknowledgedAt === null)).toBe(true);
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an offline transport never rolls back local writes and leaves outbox work pending", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-offline-"));
  const dataDir = path.join(directory, "data");
  const transport = {
    exchange: () =>
      Effect.fail(SyncTransportError.make({ message: "network unavailable", retryable: true })),
  };
  const runtime = ManagedRuntime.make(
    layer({ dataDir, migrationsFolder, syncTransport: transport }),
  );

  try {
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

    const reopened = ManagedRuntime.make(layer({ dataDir, migrationsFolder }));
    try {
      expect(await reopened.runPromise(store((store) => store.getProduct(product.id)))).toEqual(
        product,
      );
    } finally {
      await reopened.dispose();
    }

    const pending = await readOutbox(dataDir);
    expect(pending).toHaveLength(2);
    expect(pending.every((operation) => operation.acknowledgedAt === null)).toBe(true);
    expect(pending.every((operation) => operation.attemptCount > 0)).toBe(true);
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);

test("a flaky transport is retried and the outbox drains", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-sync-retry-"));
  const dataDir = path.join(directory, "data");
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
  const runtime = ManagedRuntime.make(
    layer({ dataDir, migrationsFolder, syncTransport: transport }),
  );

  try {
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
    expect(outbox.length).toBeGreaterThan(0);
    expect(outbox.every((operation) => operation.acknowledgedAt !== null)).toBe(true);
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a permanently failing transport still fails after retries", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-sync-retry-"));
  const dataDir = path.join(directory, "data");
  let attempts = 0;
  const transport = {
    exchange: () => {
      attempts += 1;
      return Effect.fail(
        SyncTransportError.make({ message: "network unavailable", retryable: true }),
      );
    },
  };
  const runtime = ManagedRuntime.make(
    layer({ dataDir, migrationsFolder, syncTransport: transport }),
  );

  try {
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
    expect(outbox.every((operation) => operation.lastError === "network unavailable")).toBe(true);
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);

test("a non-retryable transport error fails once with its protocol details", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-sync-validation-"));
  const dataDir = path.join(directory, "data");
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
  const runtime = ManagedRuntime.make(
    layer({ dataDir, migrationsFolder, syncTransport: transport }),
  );

  try {
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
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a remote product change creates a product that does not exist locally", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-sync-pull-"));
  const dataDir = path.join(directory, "data");
  let runtime: ManagedRuntime.ManagedRuntime<OfflineStore, PersistenceError> | undefined;

  try {
    const template = await seedProduct(dataDir, 1);
    const source = await capturedProductRow(dataDir, template.id);
    const remoteId = "remote-product";
    const remote = remoteProductChange({
      cursor: 1,
      source,
      id: remoteId,
      name: "Remote product",
      rowVersion: 4,
    });
    runtime = ManagedRuntime.make(
      layer({ dataDir, migrationsFolder, syncTransport: transportFor([remote]) }),
    );

    await expect(runtime.runPromise(store((store) => store.sync))).resolves.toMatchObject({
      phase: "idle",
    });
    const product = await runtime.runPromise(store((store) => store.getProduct(remoteId)));

    expect(product).toMatchObject({ id: remoteId, name: "Remote product", rowVersion: 4 });
    expect(await runtime.runPromise(store((store) => store.listProducts))).toHaveLength(2);
  } finally {
    await runtime?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a stale remote product change is skipped", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-sync-pull-"));
  const dataDir = path.join(directory, "data");
  let runtime: ManagedRuntime.ManagedRuntime<OfflineStore, PersistenceError> | undefined;

  try {
    const local = await seedProduct(dataDir, 3);
    const source = await capturedProductRow(dataDir, local.id);
    const stale = remoteProductChange({
      cursor: 1,
      source,
      name: "Stale remote name",
      rowVersion: 2,
    });
    runtime = ManagedRuntime.make(
      layer({ dataDir, migrationsFolder, syncTransport: transportFor([stale]) }),
    );

    await expect(runtime.runPromise(store((store) => store.sync))).resolves.toMatchObject({
      phase: "idle",
    });
    const product = await runtime.runPromise(store((store) => store.getProduct(local.id)));

    expect(product.name).toBe("Local product v3");
    expect(product.rowVersion).toBe(3);
  } finally {
    await runtime?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a newer remote product change replaces the local row", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-sync-pull-"));
  const dataDir = path.join(directory, "data");
  let runtime: ManagedRuntime.ManagedRuntime<OfflineStore, PersistenceError> | undefined;

  try {
    const local = await seedProduct(dataDir, 3);
    const source = await capturedProductRow(dataDir, local.id);
    const newer = remoteProductChange({
      cursor: 1,
      source,
      name: "Newer remote name",
      rowVersion: 4,
    });
    runtime = ManagedRuntime.make(
      layer({ dataDir, migrationsFolder, syncTransport: transportFor([newer]) }),
    );

    await expect(runtime.runPromise(store((store) => store.sync))).resolves.toMatchObject({
      phase: "idle",
    });
    const product = await runtime.runPromise(store((store) => store.getProduct(local.id)));

    expect(product.name).toBe("Newer remote name");
    expect(product.rowVersion).toBe(4);
  } finally {
    await runtime?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
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
  const directory = await mkdtemp(path.join(tmpdir(), "store-sync-backoff-"));
  const dataDir = path.join(directory, "data");
  const transport = {
    exchange: () =>
      Effect.fail(SyncTransportError.make({ message: "network unavailable", retryable: true })),
  };
  const runtime = ManagedRuntime.make(
    layer({ dataDir, migrationsFolder, syncTransport: transport }),
  );

  try {
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
    for (const operation of outbox) {
      expect(operation.attemptCount).toBeGreaterThan(0);
      expect(operation.nextAttemptAt).not.toBeNull();
      expect(operation.nextAttemptAt as number).toBeGreaterThan(before);
    }
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);

test("an operation that is not yet due is not resent", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-sync-backoff-"));
  const dataDir = path.join(directory, "data");
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
  const runtime = ManagedRuntime.make(
    layer({ dataDir, migrationsFolder, syncTransport: transport }),
  );

  try {
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
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);

test("status reports the stuck queue after a failure", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-sync-status-"));
  const dataDir = path.join(directory, "data");
  const transport = {
    exchange: () =>
      Effect.fail(SyncTransportError.make({ message: "network unavailable", retryable: true })),
  };
  const runtime = ManagedRuntime.make(
    layer({ dataDir, migrationsFolder, syncTransport: transport }),
  );

  try {
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
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);

test("a subsequent successful exchange clears the backoff and status", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-sync-recover-"));
  const dataDir = path.join(directory, "data");
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
  const runtime = ManagedRuntime.make(
    layer({ dataDir, migrationsFolder, syncTransport: transport }),
  );

  try {
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
    expect(outbox.every((operation) => operation.acknowledgedAt !== null)).toBe(true);
    expect(outbox.every((operation) => operation.nextAttemptAt === null)).toBe(true);
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);

test("out-of-order remote cursors reject and roll back every pulled row", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-sync-pull-"));
  const dataDir = path.join(directory, "data");
  let runtime: ManagedRuntime.ManagedRuntime<OfflineStore, PersistenceError> | undefined;

  try {
    const template = await seedProduct(dataDir, 1);
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
    runtime = ManagedRuntime.make(
      layer({ dataDir, migrationsFolder, syncTransport: transportFor(outOfOrder) }),
    );
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
  } finally {
    await runtime?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
