import type { SyncEntityChange, SyncOperation } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { protocolError } from "./errors";
import type { SyncActor } from "./model";

export type EntityRow = Readonly<Record<string, unknown>>;

const EntityRow = Schema.Record(Schema.String, Schema.Unknown);

const invalidRow = (message: string) => Effect.fail(protocolError("INVALID_ENTITY_ROW", message));

export const rowOf = Effect.fn("SyncRow.rowOf")(function* (change: SyncEntityChange) {
  const row = yield* Schema.decodeUnknownEffect(EntityRow)(change.row).pipe(
    Effect.mapError(() =>
      protocolError(
        "INVALID_ENTITY_ROW",
        `${change.entity} ${change.entityId} has an invalid row.`,
      ),
    ),
  );
  if (row.id !== undefined && row.id !== change.entityId)
    return yield* Effect.fail(
      protocolError("ENTITY_ID_MISMATCH", `${change.entity} row id does not match its change id.`),
    );
  return row;
});

export const stringValue = Effect.fn("SyncRow.stringValue")(function* (
  row: EntityRow,
  key: string,
) {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0)
    return yield* invalidRow(`${key} must be a non-empty string.`);
  return value;
});

export const nullableString = Effect.fn("SyncRow.nullableString")(function* (
  row: EntityRow,
  key: string,
) {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return yield* invalidRow(`${key} must be a string or null.`);
  return value;
});

export const integerValue = Effect.fn("SyncRow.integerValue")(function* (
  row: EntityRow,
  key: string,
  minimum = 0,
) {
  const value = row[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum)
    return yield* invalidRow(`${key} must be a safe integer of at least ${minimum}.`);
  return value;
});

export const signedInteger = Effect.fn("SyncRow.signedInteger")(function* (
  row: EntityRow,
  key: string,
) {
  const value = row[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    return yield* invalidRow(`${key} must be a safe integer.`);
  return value;
});

export const nullableInteger = Effect.fn("SyncRow.nullableInteger")(function* (
  row: EntityRow,
  key: string,
  minimum = 0,
) {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum)
    return yield* invalidRow(`${key} must be a safe integer or null.`);
  return value;
});

export const booleanValue = Effect.fn("SyncRow.booleanValue")(function* (
  row: EntityRow,
  key: string,
) {
  const value = row[key];
  if (typeof value !== "boolean") return yield* invalidRow(`${key} must be a boolean.`);
  return value;
});

export const quantityTypeValue: (
  row: EntityRow,
) => Effect.Effect<"unit" | "pack", ReturnType<typeof protocolError>> = Effect.fn(
  "SyncRow.quantityTypeValue",
)(function* (row: EntityRow) {
  const value = yield* stringValue(row, "quantityType");
  if (value === "unit") return "unit";
  if (value === "pack") return "pack";
  return yield* invalidRow("quantityType must be unit or pack.");
});

export const movementTypeValue: (
  row: EntityRow,
) => Effect.Effect<
  "stock_in" | "sale" | "open_pack" | "adjustment",
  ReturnType<typeof protocolError>
> = Effect.fn("SyncRow.movementTypeValue")(function* (row: EntityRow) {
  const value = yield* stringValue(row, "type");
  if (value === "stock_in") return "stock_in";
  if (value === "sale") return "sale";
  if (value === "open_pack") return "open_pack";
  if (value === "adjustment") return "adjustment";
  return yield* invalidRow("Invalid stock movement type.");
});

export const commonMutable = Effect.fn("SyncRow.commonMutable")(function* (
  actor: SyncActor,
  operation: SyncOperation,
  change: SyncEntityChange,
  row: EntityRow,
  current:
    | { readonly createdAt: number; readonly createdByUserId: string; readonly rowVersion: number }
    | undefined,
) {
  const occurredAt = operation.occurredAt;
  const createdAt = current?.createdAt ?? (yield* nullableInteger(row, "createdAt")) ?? occurredAt;
  return {
    id: change.entityId,
    organizationId: actor.organizationId,
    createdAt,
    updatedAt: occurredAt,
    deletedAt: change.action === "delete" ? occurredAt : null,
    createdByUserId: current?.createdByUserId ?? actor.userId,
    updatedByUserId: actor.userId,
    deviceId: operation.deviceId,
    operationId: operation.operationId,
    rowVersion: Math.max(change.rowVersion, (current?.rowVersion ?? 0) + 1, 1),
  };
});
