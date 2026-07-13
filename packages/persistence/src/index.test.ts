import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { expect, test } from "vitest";
import { layer, program } from "./index";

const migrationsFolder = path.resolve(import.meta.dirname, "../../db/drizzle");

test("product CRUD remains available without sync configuration", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-offline-"));
  const runtime = ManagedRuntime.make(
    layer({ path: path.join(directory, "store.db"), migrationsFolder }),
  );

  try {
    const created = await runtime.runPromise(
      program.createProduct({
        name: "  Panadol  ",
        categoryId: "medicine",
        aisle: "A3",
        composition: "Paracetamol",
        strength: "500mg",
        unitsPerPack: 10,
        packPrice: 1500,
        unitPrice: 200,
      }),
    );
    expect(created.name).toBe("Panadol");
    expect(created.category).toMatchObject({ id: "medicine", name: "Medicine" });
    expect(await runtime.runPromise(program.listCategories)).toHaveLength(3);
    expect(await runtime.runPromise(program.listProducts)).toEqual([created]);
    expect(await runtime.runPromise(program.getProduct(created.id))).toEqual(created);

    const updated = await runtime.runPromise(
      program.updateProduct({
        id: created.id,
        name: "Panadol Extra",
        categoryId: "medicine",
        aisle: "A4",
        composition: "Paracetamol + Caffeine",
        strength: "500mg",
        unitsPerPack: 12,
        packPrice: 1800,
        unitPrice: 150,
      }),
    );
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.name).toBe("Panadol Extra");
    expect(updated.unitsPerPack).toBe(12);

    await runtime.runPromise(program.deleteProduct(created.id));
    expect(await runtime.runPromise(program.listProducts)).toEqual([]);
    expect(await runtime.runPromise(program.getSyncStatus)).toMatchObject({
      configured: false,
      phase: "local-only",
    });
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("category and units default when omitted", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-offline-"));
  const runtime = ManagedRuntime.make(
    layer({ path: path.join(directory, "store.db"), migrationsFolder }),
  );

  try {
    const created = await runtime.runPromise(
      program.createProduct({
        name: "Baby Shampoo",
        aisle: null,
        composition: null,
        strength: null,
        packPrice: 45000,
        unitPrice: null,
      }),
    );
    expect(created.category).toMatchObject({ id: "general", name: "General" });
    expect(created.unitsPerPack).toBe(1);
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("selling draws stock from batches, earliest expiry first", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-offline-"));
  const runtime = ManagedRuntime.make(
    layer({ path: path.join(directory, "store.db"), migrationsFolder }),
  );

  try {
    const product = await runtime.runPromise(
      program.createProduct({
        name: "Panadol",
        aisle: null,
        composition: null,
        strength: null,
        packPrice: null,
        unitPrice: 200,
        unitsPerPack: 10,
      }),
    );
    const later = await runtime.runPromise(
      program.createBatch({
        productId: product.id,
        batchNumber: "B-2027",
        expiresAt: Date.parse("2027-06-01"),
        packQuantity: 5,
        unitQuantity: 0,
      }),
    );
    const earlier = await runtime.runPromise(
      program.createBatch({
        productId: product.id,
        batchNumber: "B-2026",
        expiresAt: Date.parse("2026-12-01"),
        packQuantity: 2,
        unitQuantity: 0,
      }),
    );

    const invoice = await runtime.runPromise(
      program.createInvoice({
        customerName: "Walk-in",
        items: [
          {
            productId: product.id,
            batchId: null,
            quantity: 30,
            quantityType: "unit",
            salePrice: 200,
          },
        ],
      }),
    );
    expect(invoice.invoiceNumber).toMatch(/^local-[0-9a-f-]{36}$/);
    expect(invoice.total).toBe(6000);
    expect(invoice.items).toHaveLength(2);
    expect(invoice.items[0]).toMatchObject({
      productName: "Panadol",
      batchId: earlier.id,
      batchNumber: "B-2026",
      quantity: 20,
      quantityType: "unit",
      baseUnitQuantity: 20,
      salePrice: 200,
    });
    expect(invoice.items[1]).toMatchObject({ batchId: later.id, quantity: 10 });

    const reloaded = await runtime.runPromise(program.getProduct(product.id));
    expect(reloaded.batches.map((batch) => batch.packQuantity)).toContain(0);
    expect(
      reloaded.batches.reduce(
        (sum, batch) => sum + batch.packQuantity * 10 + batch.unitQuantity,
        0,
      ),
    ).toBe(40);

    // Selling more than the remaining stock fails and changes nothing.
    await expect(
      runtime.runPromise(
        program.createInvoice({
          customerName: null,
          items: [
            {
              productId: product.id,
              batchId: null,
              quantity: 41,
              quantityType: "unit",
              salePrice: 200,
            },
          ],
        }),
      ),
    ).rejects.toThrow(/Not enough stock/);
    const untouched = await runtime.runPromise(program.getProduct(product.id));
    expect(
      untouched.batches.reduce(
        (sum, batch) => sum + batch.packQuantity * 10 + batch.unitQuantity,
        0,
      ),
    ).toBe(40);

    // Selling from an explicitly chosen batch only touches that batch.
    const fromBatch = await runtime.runPromise(
      program.createInvoice({
        customerName: null,
        items: [
          {
            productId: product.id,
            batchId: later.id,
            quantity: 5,
            quantityType: "unit",
            salePrice: 150,
          },
        ],
      }),
    );
    expect(fromBatch.invoiceNumber).toMatch(/^local-[0-9a-f-]{36}$/);
    expect(fromBatch.invoiceNumber).not.toBe(invoice.invoiceNumber);
    expect(fromBatch.items).toEqual([
      expect.objectContaining({
        batchId: later.id,
        quantity: 5,
        quantityType: "unit",
        salePrice: 150,
      }),
    ]);

    const movements = await runtime.runPromise(program.listStockMovements(product.id));
    expect(movements.some((movement) => movement.type === "stock_in")).toBe(true);
    expect(movements.some((movement) => movement.type === "open_pack")).toBe(true);
    expect(movements.some((movement) => movement.type === "sale")).toBe(true);

    const invoicesList = await runtime.runPromise(program.listInvoices);
    expect(invoicesList.map((row) => row.invoiceNumber)).toEqual([
      fromBatch.invoiceNumber,
      invoice.invoiceNumber,
    ]);
    expect(await runtime.runPromise(program.getInvoice(invoice.id))).toEqual(invoice);
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("offline mutations keep immutable organization, actor, device, and operation attribution", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-offline-"));
  const context = {
    organizationId: "org-pharmacy",
    userId: "user-owner",
    deviceId: "device-counter-one",
  };
  const runtime = ManagedRuntime.make(
    layer({
      path: path.join(directory, "store.db"),
      migrationsFolder,
      mutationContext: () => context,
    }),
  );

  try {
    const product = await runtime.runPromise(
      program.createProduct({
        name: "Attributed product",
        aisle: null,
        composition: null,
        strength: null,
        unitsPerPack: 1,
        packPrice: null,
        unitPrice: 100,
      }),
    );
    const batch = await runtime.runPromise(
      program.createBatch({
        productId: product.id,
        batchNumber: null,
        expiresAt: null,
        packQuantity: 0,
        unitQuantity: 2,
      }),
    );
    const invoice = await runtime.runPromise(
      program.createInvoice({
        customerName: null,
        items: [
          {
            productId: product.id,
            batchId: batch.id,
            quantity: 1,
            quantityType: "unit",
            salePrice: 100,
          },
        ],
      }),
    );

    expect(invoice).toMatchObject({
      organizationId: context.organizationId,
      createdByUserId: context.userId,
      deviceId: context.deviceId,
    });
    expect(invoice.invoiceNumber).toBe(`deviceco-${invoice.operationId}`);

    const movements = await runtime.runPromise(program.listStockMovements(product.id));
    const saleMovements = movements.filter((movement) => movement.invoiceId === invoice.id);
    expect(saleMovements.length).toBeGreaterThan(0);
    expect(saleMovements.every((movement) => movement.operationId === invoice.operationId)).toBe(
      true,
    );
    expect(saleMovements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: context.organizationId,
          actorUserId: context.userId,
          deviceId: context.deviceId,
        }),
      ]),
    );
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("sealed packs and loose units remain distinct through sales", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-offline-"));
  const runtime = ManagedRuntime.make(
    layer({ path: path.join(directory, "store.db"), migrationsFolder }),
  );

  try {
    const product = await runtime.runPromise(
      program.createProduct({
        name: "Tablet box",
        aisle: "B2",
        composition: null,
        strength: null,
        unitsPerPack: 30,
        packPrice: 3000,
        unitPrice: 110,
      }),
    );
    const batch = await runtime.runPromise(
      program.createBatch({
        productId: product.id,
        batchNumber: "BOX-1",
        expiresAt: null,
        packQuantity: 10,
        unitQuantity: 6,
      }),
    );

    await runtime.runPromise(
      program.createInvoice({
        customerName: null,
        items: [
          {
            productId: product.id,
            batchId: batch.id,
            quantity: 7,
            quantityType: "unit",
            salePrice: 110,
          },
        ],
      }),
    );
    let reloaded = await runtime.runPromise(program.getProduct(product.id));
    expect(reloaded.batches[0]).toMatchObject({ packQuantity: 9, unitQuantity: 29 });

    await runtime.runPromise(
      program.createInvoice({
        customerName: null,
        items: [
          {
            productId: product.id,
            batchId: batch.id,
            quantity: 2,
            quantityType: "pack",
            salePrice: 3000,
          },
        ],
      }),
    );
    reloaded = await runtime.runPromise(program.getProduct(product.id));
    expect(reloaded.batches[0]).toMatchObject({ packQuantity: 7, unitQuantity: 29 });

    const movements = await runtime.runPromise(program.listStockMovements(product.id));
    expect(movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "open_pack", packDelta: -1, unitDelta: 30 }),
        expect.objectContaining({ type: "sale", packDelta: 0, unitDelta: -7 }),
        expect.objectContaining({ type: "sale", packDelta: -2, unitDelta: 0 }),
      ]),
    );
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("migrations are idempotent and preserve existing products", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-offline-"));
  const databasePath = path.join(directory, "store.db");

  try {
    const firstRuntime = ManagedRuntime.make(layer({ path: databasePath, migrationsFolder }));
    const created = await firstRuntime.runPromise(
      program.createProduct({
        name: "Aspirin",
        aisle: null,
        composition: null,
        strength: null,
        packPrice: null,
        unitPrice: null,
      }),
    );
    await firstRuntime.dispose();

    const secondRuntime = ManagedRuntime.make(layer({ path: databasePath, migrationsFolder }));
    expect(await secondRuntime.runPromise(program.listProducts)).toEqual([created]);
    await secondRuntime.dispose();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
