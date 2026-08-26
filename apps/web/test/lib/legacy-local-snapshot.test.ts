import { decodeCategoryId, decodeProductId } from "@store/contracts/ids";
import { describe, expect, it } from "vitest";

import { decodeLegacyLocalInventorySnapshot } from "../../src/lib/legacy-local-snapshot";

const catalogCategory = {
  id: decodeCategoryId("medicine"),
  name: "Medicine",
  tracksPacks: true,
  createdAt: 1,
  updatedAt: 2,
};

describe("legacy local snapshot decode", () => {
  it("keeps the migration catalog when locked replica rows fail to decode", () => {
    const snapshot = decodeLegacyLocalInventorySnapshot({
      categories: [{ id: "broken" }],
      products: [],
      batches: [],
      invoices: [],
      invoiceItems: [],
      stockMovements: [],
      migrationCatalog: {
        categories: [catalogCategory],
        products: [
          {
            id: decodeProductId("panadol"),
            name: "Panadol",
            categoryId: decodeCategoryId("medicine"),
            aisle: null,
            composition: null,
            strength: null,
            unitsPerPack: 10,
            packPrice: 100,
            unitPrice: 10,
            visible: true,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        batches: [],
        invoices: [],
        invoiceItems: [],
        stockMovements: [],
      },
    });

    expect(snapshot.categories).toEqual([]);
    expect(snapshot.migrationCatalog.categories).toEqual([catalogCategory]);
    expect(snapshot.migrationCatalog.products).toHaveLength(1);
  });
});
