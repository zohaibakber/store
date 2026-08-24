import { UpdateType } from "@powersync/common";
import { describe, expect, it } from "vitest";

import { decodePowerSyncCatalogCrudEntry, stampCatalogUploadRow } from "../src/powersync";

const category = {
  id: "category-1",
  name: "Pain relief",
  tracksPacks: 1,
  organizationId: "org-1",
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
  deviceId: "device-1",
  operationId: "operation-1",
  rowVersion: 1,
  createdAt: 100,
  updatedAt: 100,
  deletedAt: null,
};

describe("PowerSync catalog upload snapshots", () => {
  it("reconstructs each offline patch from its own previous values", () => {
    const first = decodePowerSyncCatalogCrudEntry("categories", {
      id: category.id,
      op: UpdateType.PATCH,
      previousValues: category,
      opData: {
        name: "Pain and fever",
        operationId: "operation-2",
        rowVersion: 2,
        updatedAt: 200,
      },
    });
    const second = decodePowerSyncCatalogCrudEntry("categories", {
      id: category.id,
      op: UpdateType.PATCH,
      previousValues: { ...category, ...first, tracksPacks: 1 },
      opData: {
        name: "Pain, fever, and cold",
        operationId: "operation-3",
        rowVersion: 3,
        updatedAt: 300,
      },
    });

    expect(first).toMatchObject({ name: "Pain and fever", rowVersion: 2 });
    expect(second).toMatchObject({ name: "Pain, fever, and cold", rowVersion: 3 });
  });

  it("supplies null SQLite defaults omitted from an insert", () => {
    const { deletedAt: omitted, ...insert } = category;
    expect(omitted).toBeNull();
    expect(
      decodePowerSyncCatalogCrudEntry("categories", {
        id: category.id,
        op: UpdateType.PUT,
        opData: insert,
      }),
    ).toMatchObject({ id: category.id, deletedAt: null, tracksPacks: true });
  });

  it("keeps the row mutation id instead of a replica-local CRUD sequence", () => {
    expect(stampCatalogUploadRow(category).operationId).toBe("operation-1");
    expect(
      stampCatalogUploadRow({ ...category, id: "category-2", operationId: "operation-2" })
        .operationId,
    ).toBe("operation-2");
  });
});
