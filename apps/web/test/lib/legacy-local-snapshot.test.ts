import { decodeCategoryId } from "@store/contracts/ids";
import { describe, expect, it } from "vitest";

import { decodeLegacyLocalInventorySnapshot } from "../../src/lib/legacy-local-snapshot";

describe("legacy local snapshot decode", () => {
  it("returns an empty snapshot when locked replica rows fail to decode", () => {
    const snapshot = decodeLegacyLocalInventorySnapshot({
      categories: [{ id: "broken" }],
      products: [],
      batches: [],
      invoices: [],
      invoiceItems: [],
      stockMovements: [],
    });

    expect(snapshot).toEqual({
      categories: [],
      products: [],
      batches: [],
      invoices: [],
      invoiceItems: [],
      stockMovements: [],
    });
  });

  it("normalizes sqlite boolean columns", () => {
    const snapshot = decodeLegacyLocalInventorySnapshot({
      categories: [
        {
          id: decodeCategoryId("medicine"),
          name: "Medicine",
          tracksPacks: 1,
          createdAt: 1,
          updatedAt: 2,
          deletedAt: null,
          organizationId: "local",
          createdByUserId: "user-1",
          updatedByUserId: "user-1",
          deviceId: "device-1",
          operationId: "op-1",
          rowVersion: 1,
        },
      ],
      products: [],
      batches: [],
      invoices: [],
      invoiceItems: [],
      stockMovements: [],
    });

    expect(snapshot.categories[0]?.tracksPacks).toBe(true);
  });
});
