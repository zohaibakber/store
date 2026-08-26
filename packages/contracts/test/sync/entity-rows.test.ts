import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { expect, test } from "vitest";

import { syncEntityPushRows, syncEntityRows } from "../../src/sync/entity-rows";

/** Compat until retirement: Durable Object / `/api/sync/live` WebSocket types. */
const productRow = {
  id: "product-1",
  name: "Panadol",
  categoryId: "medicine",
  aisle: null,
  composition: null,
  strength: null,
  unitsPerPack: 10,
  packPrice: 1000,
  unitPrice: 100,
  visible: true,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  organizationId: "org-1",
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
  deviceId: "device-1",
  operationId: "operation-1",
  rowVersion: 1,
};

const decodeApply = <Row>(row: Row) =>
  Schema.decodeUnknownResult(syncEntityRows.product.schema)(row);
const decodePush = <Row>(row: Row) => Schema.decodeUnknownResult(syncEntityPushRows.product)(row);

test("a well-formed product row decodes in both directions", () => {
  expect(Result.isSuccess(decodeApply(productRow))).toBe(true);
  expect(Result.isSuccess(decodePush(productRow))).toBe(true);
});

test("both directions reject the rows only the server used to reject", () => {
  for (const invalid of [
    { ...productRow, name: "" },
    { ...productRow, unitsPerPack: 0 },
    { ...productRow, packPrice: -1 },
  ]) {
    expect(Result.isFailure(decodeApply(invalid))).toBe(true);
    expect(Result.isFailure(decodePush(invalid))).toBe(true);
  }
});

test("a pushed row need not carry the columns the receiver assigns", () => {
  const {
    updatedAt: _updatedAt,
    deletedAt: _deletedAt,
    organizationId: _organizationId,
    createdByUserId: _createdByUserId,
    updatedByUserId: _updatedByUserId,
    deviceId: _deviceId,
    operationId: _operationId,
    rowVersion: _rowVersion,
    ...pushed
  } = productRow;

  const decoded = decodePush(pushed);
  expect(Result.isSuccess(decoded)).toBe(true);
  expect(Result.isFailure(decodeApply(pushed))).toBe(true);
});

test("a pushed row cannot claim its own attribution", () => {
  const decoded = decodePush({ ...productRow, createdByUserId: "impostor" });
  expect(Result.isSuccess(decoded)).toBe(true);
  expect(decoded.pipe(Result.getOrThrow)).not.toHaveProperty("createdByUserId");
});

test("a pushed stock movement cannot claim its own actor", () => {
  const movement = {
    id: "movement-1",
    productId: "product-1",
    batchId: "batch-1",
    invoiceId: null,
    type: "sale",
    packDelta: 0,
    unitDelta: -1,
    note: null,
    createdAt: 1,
    actorUserId: "impostor",
  };
  const decoded = Schema.decodeUnknownResult(syncEntityPushRows.stockMovement)(movement);
  expect(Result.isSuccess(decoded)).toBe(true);
  expect(decoded.pipe(Result.getOrThrow)).not.toHaveProperty("actorUserId");
});
