import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SyncRequest, SyncResponse } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { expect, test } from "vitest";
import { layer, program, SyncTransportError } from "./index";
import { migrationsFolder, readOutbox } from "./test-support";

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

test("each business mutation commits one durable sync operation", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-offline-"));
  const dataDir = path.join(directory, "pglite");
  const runtime = ManagedRuntime.make(layer({ dataDir, migrationsFolder }));

  try {
    const product = await runtime.runPromise(
      program.createProduct({
        name: "Queued product",
        aisle: null,
        composition: null,
        strength: null,
        packPrice: null,
        unitPrice: 250,
      }),
    );
    await runtime.runPromise(
      program.createBatch({
        productId: product.id,
        batchNumber: "QUEUE-1",
        expiresAt: null,
        packQuantity: 1,
        unitQuantity: 2,
      }),
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
  const dataDir = path.join(directory, "pglite");
  const transport = {
    exchange: () => Effect.fail(SyncTransportError.make({ message: "network unavailable" })),
  };
  const runtime = ManagedRuntime.make(
    layer({ dataDir, migrationsFolder, syncTransport: transport }),
  );

  try {
    const product = await runtime.runPromise(
      program.createProduct({
        name: "Offline write",
        aisle: null,
        composition: null,
        strength: null,
        packPrice: null,
        unitPrice: null,
      }),
    );
    await expect(runtime.runPromise(program.sync)).rejects.toThrow(/network unavailable/);
    expect(await runtime.runPromise(program.getProduct(product.id))).toEqual(product);
    expect(await runtime.runPromise(program.getSyncStatus)).toMatchObject({
      configured: true,
      phase: "error",
    });
    await runtime.dispose();

    const reopened = ManagedRuntime.make(layer({ dataDir, migrationsFolder }));
    try {
      expect(await reopened.runPromise(program.getProduct(product.id))).toEqual(product);
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
  const dataDir = path.join(directory, "pglite");
  let attempts = 0;
  const transport = {
    exchange: (request: SyncRequest) => {
      attempts += 1;
      return attempts <= 2
        ? Effect.fail(SyncTransportError.make({ message: "temporary network failure" }))
        : Effect.succeed(responseFor(request));
    },
  };
  const runtime = ManagedRuntime.make(
    layer({ dataDir, migrationsFolder, syncTransport: transport }),
  );

  try {
    await runtime.runPromise(
      program.createProduct({
        name: "Eventually synced",
        aisle: null,
        composition: null,
        strength: null,
        packPrice: null,
        unitPrice: null,
      }),
    );
    await expect(runtime.runPromise(program.sync)).resolves.toMatchObject({ phase: "idle" });
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
  const dataDir = path.join(directory, "pglite");
  let attempts = 0;
  const transport = {
    exchange: () => {
      attempts += 1;
      return Effect.fail(SyncTransportError.make({ message: "network unavailable" }));
    },
  };
  const runtime = ManagedRuntime.make(
    layer({ dataDir, migrationsFolder, syncTransport: transport }),
  );

  try {
    await runtime.runPromise(
      program.createProduct({
        name: "Still pending",
        aisle: null,
        composition: null,
        strength: null,
        packPrice: null,
        unitPrice: null,
      }),
    );
    await expect(runtime.runPromise(program.sync)).rejects.toMatchObject({
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
