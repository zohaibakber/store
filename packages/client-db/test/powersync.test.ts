import { UpdateType } from "@powersync/common";
import { describe, expect, it } from "vitest";

import { isIgnorableCatalogUploadError } from "../src/mutations";
import {
  catalogCrudMutationId,
  decodePowerSyncCatalogCrudEntry,
  stampCatalogUploadRow,
} from "../src/powersync";

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

  it("gives each queued write its own mutation id even when rows share one", () => {
    const first = catalogCrudMutationId({ clientId: 11 });
    const second = catalogCrudMutationId({ clientId: 12 });

    expect(first).not.toBe(second);
    expect(catalogCrudMutationId({ clientId: 11 })).toBe(first);
    expect(stampCatalogUploadRow(category, { clientId: 11 }).operationId).toBe(first);
    expect(
      stampCatalogUploadRow(
        { ...category, id: "category-2", operationId: "operation-1" },
        {
          clientId: 12,
        },
      ).operationId,
    ).toBe(second);
  });
});

describe("catalog upload conflicts", () => {
  it("treats a reused mutation id as already acknowledged", () => {
    expect(
      isIgnorableCatalogUploadError(
        new Error(
          '{"error":{"code":"OPERATION_ID_REUSED","message":"The mutation id was reused with different content."}}',
        ),
      ),
    ).toBe(true);
    expect(
      isIgnorableCatalogUploadError(
        new Error(
          '{"error":{"code":"ENTITY_CONFLICT","message":"The entity changed before this mutation was saved."}}',
        ),
      ),
    ).toBe(false);
    expect(isIgnorableCatalogUploadError(new Error("network down"))).toBe(false);
  });
});
