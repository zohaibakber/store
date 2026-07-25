import { expect, test } from "vitest";

import { store, withTestStore } from "../lib/store";

test("offline mutations keep immutable organization, actor, device, and operation attribution", async () => {
  const context = {
    organizationId: "org-pharmacy",
    userId: "user-owner",
    deviceId: "device-counter-one",
  };
  await withTestStore(
    async ({ runtime }) => {
      const product = await runtime.runPromise(
        store((store) =>
          store.createProduct({
            name: "Attributed product",
            aisle: null,
            composition: null,
            strength: null,
            unitsPerPack: 1,
            packPrice: null,
            unitPrice: 100,
          }),
        ),
      );
      const batch = await runtime.runPromise(
        store((store) =>
          store.createBatch({
            productId: product.id,
            batchNumber: null,
            expiresAt: null,
            packQuantity: 0,
            unitQuantity: 2,
          }),
        ),
      );
      const invoice = await runtime.runPromise(
        store((store) =>
          store.createInvoice({
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
        ),
      );

      expect(invoice).toMatchObject({
        organizationId: context.organizationId,
        createdByUserId: context.userId,
        deviceId: context.deviceId,
      });
      expect(invoice.invoiceNumber).toBe(1);

      const movements = await runtime.runPromise(
        store((store) => store.listStockMovements(product.id)),
      );
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
    },
    { mutationContext: () => context },
  );
});
