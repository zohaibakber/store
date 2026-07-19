import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { formatInvoiceNumber } from "@store/contracts";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { expect, test } from "vitest";
import { layer } from "./index";
import { migrationsFolder, store } from "./test-support";

test("selling draws stock from batches, earliest expiry first", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "store-offline-"));
  const runtime = ManagedRuntime.make(
    layer({ dataDir: path.join(directory, "pglite"), migrationsFolder }),
  );

  try {
    const product = await runtime.runPromise(
      store((store) =>
        store.createProduct({
          name: "Panadol",
          aisle: null,
          composition: null,
          strength: null,
          packPrice: null,
          unitPrice: 200,
          unitsPerPack: 10,
        }),
      ),
    );
    const later = await runtime.runPromise(
      store((store) =>
        store.createBatch({
          productId: product.id,
          batchNumber: "B-2027",
          expiresAt: Date.parse("2027-06-01"),
          packQuantity: 5,
          unitQuantity: 0,
        }),
      ),
    );
    const earlier = await runtime.runPromise(
      store((store) =>
        store.createBatch({
          productId: product.id,
          batchNumber: "B-2026",
          expiresAt: Date.parse("2026-12-01"),
          packQuantity: 2,
          unitQuantity: 0,
        }),
      ),
    );

    const invoice = await runtime.runPromise(
      store((store) =>
        store.createInvoice({
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
      ),
    );
    expect(invoice.invoiceNumber).toBe(1);
    expect(formatInvoiceNumber(invoice.invoiceNumber)).toBe("0001");
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

    const reloaded = await runtime.runPromise(store((store) => store.getProduct(product.id)));
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
        store((store) =>
          store.createInvoice({
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
      ),
    ).rejects.toThrow(/Not enough stock/);
    const untouched = await runtime.runPromise(store((store) => store.getProduct(product.id)));
    expect(
      untouched.batches.reduce(
        (sum, batch) => sum + batch.packQuantity * 10 + batch.unitQuantity,
        0,
      ),
    ).toBe(40);

    // Selling from an explicitly chosen batch only touches that batch.
    const fromBatch = await runtime.runPromise(
      store((store) =>
        store.createInvoice({
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
      ),
    );
    expect(fromBatch.invoiceNumber).toBe(2);
    expect(fromBatch.items).toEqual([
      expect.objectContaining({
        batchId: later.id,
        quantity: 5,
        quantityType: "unit",
        salePrice: 150,
      }),
    ]);

    const movements = await runtime.runPromise(
      store((store) => store.listStockMovements(product.id)),
    );
    expect(movements.some((movement) => movement.type === "stock_in")).toBe(true);
    expect(movements.some((movement) => movement.type === "open_pack")).toBe(true);
    expect(movements.some((movement) => movement.type === "sale")).toBe(true);

    const invoicesList = await runtime.runPromise(store((store) => store.listInvoices));
    expect(invoicesList.map((row) => row.invoiceNumber)).toEqual([
      fromBatch.invoiceNumber,
      invoice.invoiceNumber,
    ]);
    expect(await runtime.runPromise(store((store) => store.getInvoice(invoice.id)))).toEqual(
      invoice,
    );
    expect(formatInvoiceNumber(9999)).toBe("9999");
    expect(formatInvoiceNumber(10000)).toBe("10000");
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
