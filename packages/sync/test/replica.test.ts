import { describe, expect, it } from "vitest"

import {
  applyChanges,
  commandChanges,
  diffFromChanges,
  emptyReplicaSnapshot,
} from "../src/replica"

const category = {
  id: "cat-1",
  name: "Pain relief",
  tracksPacks: true,
  organizationId: "org-1",
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
  deviceId: "device-1",
  operationId: "op-1",
  rowVersion: 1,
  createdAt: 100,
  updatedAt: 100,
  deletedAt: null,
}

describe("catalog replica", () => {
  it("upserts and deletes rows by entity id", () => {
    const inserted = applyChanges(emptyReplicaSnapshot(), [
      {
        entity: "category",
        action: "upsert",
        entityId: category.id,
        rowVersion: 1,
        row: category,
      },
    ])
    expect(inserted.rows.category).toEqual([category])

    const deleted = applyChanges(inserted, [
      {
        entity: "category",
        action: "delete",
        entityId: category.id,
        rowVersion: 2,
        row: null,
      },
    ])
    expect(deleted.rows.category).toEqual([])
  })

  it("groups diffs by entity", () => {
    const diffs = diffFromChanges([
      {
        entity: "product",
        action: "upsert",
        entityId: "p1",
        rowVersion: 1,
        row: { id: "p1" },
      },
      {
        entity: "product",
        action: "delete",
        entityId: "p2",
        rowVersion: 1,
        row: null,
      },
    ])
    expect(diffs).toEqual([
      {
        entity: "product",
        upserts: [{ id: "p1", row: { id: "p1" } }],
        deletes: ["p2"],
      },
    ])
  })

  it("reads catalog write rows as replica changes", () => {
    expect(
      commandChanges({
        operationId: "op-1",
        organizationId: "org-1",
        deviceId: "device-1",
        actorUserId: "user-1",
        occurredAt: 100,
        entity: "category",
        rows: [category],
      }),
    ).toEqual([
      {
        entity: "category",
        action: "upsert",
        entityId: category.id,
        rowVersion: 1,
        row: category,
      },
    ])
  })
})
