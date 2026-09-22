import type * as IndexedDbQueryBuilder from "@effect/platform-browser/IndexedDbQueryBuilder";
import {
  compareDecimalSequence,
  SyncCommandEnvelope,
  SyncEntity,
  syncProtocolError,
  type SnapshotId,
  type SnapshotManifest,
  type SnapshotPartPayload,
} from "@store/contracts";
import { replicaEntitySchemas, type CommandStatus } from "@store/contracts/sync/replica-model";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { decideOverlays, type VisibleStock } from "../decisions";
import { ReplicaIndexedDb } from "./schema";

type QueryBuilder = IndexedDbQueryBuilder.IndexedDbQueryBuilder<
  (typeof ReplicaIndexedDb)["version"]
>;

const entityPromoteOrder = (entity: SyncEntity): number => {
  switch (entity) {
    case "category":
      return 0;
    case "product":
      return 1;
    case "batch":
      return 2;
    case "invoice":
      return 3;
    case "invoiceItem":
      return 4;
    case "stockMovement":
      return 5;
    default: {
      const _exhaustive: never = entity;
      return _exhaustive;
    }
  }
};

const decodeEnvelope = Schema.decodeUnknownSync(Schema.fromJsonString(SyncCommandEnvelope));
const encodeRowJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const statusPrefix = (status: CommandStatus) => {
  const lower: [CommandStatus] = [status];
  const upper: [CommandStatus, []] = [status, []];
  return { lower, upper };
};

const visibleStock = (api: QueryBuilder, generation: number, batchId: string) =>
  Effect.gen(function* () {
    const batches = yield* api.from("batches").select().equals([generation, batchId]);
    const batch = batches[0];
    const overlays = yield* api.from("stock_overlays").select("byBatch").equals(batchId);
    return {
      packQuantity:
        (batch?.packQuantity ?? 0) + overlays.reduce((sum, row) => sum + row.packDelta, 0),
      unitQuantity:
        (batch?.unitQuantity ?? 0) + overlays.reduce((sum, row) => sum + row.unitDelta, 0),
    } satisfies VisibleStock;
  });

const stageSnapshotRow = (
  api: QueryBuilder,
  snapshotId: string,
  row: SnapshotPartPayload["rows"][number],
) =>
  Effect.gen(function* () {
    const entity = Schema.decodeUnknownSync(SyncEntity)(row.entity);
    Schema.decodeUnknownSync(replicaEntitySchemas[entity])(row.row);
    const existingRows = yield* api
      .from("snapshot_staged_rows")
      .select()
      .equals([snapshotId, entity, row.entityId]);
    const existing = existingRows[0];
    if (existing && existing.rowVersion > row.rowVersion) return;
    yield* api.from("snapshot_staged_rows").upsert({
      snapshotId,
      entity,
      entityId: row.entityId,
      rowVersion: row.rowVersion,
      rowJson: encodeRowJson(row.row),
    });
  });

const promoteStagedRow = (
  api: QueryBuilder,
  generation: number,
  entity: SyncEntity,
  rowJson: string,
) => {
  switch (entity) {
    case "category": {
      const parsed = Schema.decodeUnknownSync(Schema.fromJsonString(replicaEntitySchemas.category))(
        rowJson,
      );
      return api.from("categories").upsert({ generation, ...parsed });
    }
    case "product": {
      const parsed = Schema.decodeUnknownSync(Schema.fromJsonString(replicaEntitySchemas.product))(
        rowJson,
      );
      return api.from("products").upsert({ generation, ...parsed });
    }
    case "batch": {
      const parsed = Schema.decodeUnknownSync(Schema.fromJsonString(replicaEntitySchemas.batch))(
        rowJson,
      );
      return api.from("batches").upsert({ generation, ...parsed });
    }
    case "invoice": {
      const parsed = Schema.decodeUnknownSync(Schema.fromJsonString(replicaEntitySchemas.invoice))(
        rowJson,
      );
      return api.from("invoices").upsert({ generation, ...parsed });
    }
    case "invoiceItem": {
      const parsed = Schema.decodeUnknownSync(
        Schema.fromJsonString(replicaEntitySchemas.invoiceItem),
      )(rowJson);
      return api.from("invoice_items").upsert({ generation, ...parsed });
    }
    case "stockMovement": {
      const parsed = Schema.decodeUnknownSync(
        Schema.fromJsonString(replicaEntitySchemas.stockMovement),
      )(rowJson);
      return api.from("stock_movements").upsert({ generation, ...parsed });
    }
    default: {
      const _exhaustive: never = entity;
      return _exhaustive;
    }
  }
};

const promoteStagedSnapshot = (api: QueryBuilder, generation: number, snapshotId: string) =>
  Effect.gen(function* () {
    const staged = [
      ...(yield* api.from("snapshot_staged_rows").select("bySnapshot").equals(snapshotId)),
    ]
      .map((row) => ({
        entity: Schema.decodeUnknownSync(SyncEntity)(row.entity),
        rowJson: row.rowJson,
      }))
      .sort((left, right) => entityPromoteOrder(left.entity) - entityPromoteOrder(right.entity));
    for (const row of staged) {
      yield* promoteStagedRow(api, generation, row.entity, row.rowJson);
    }
    yield* api.from("snapshot_staged_rows").delete("bySnapshot").equals(snapshotId);
  });

const integrateCoveredCommands = (api: QueryBuilder, horizon: string) =>
  Effect.gen(function* () {
    const awaitingRange = statusPrefix("accepted_awaiting_integration");
    const awaiting = yield* api
      .from("command_outbox")
      .select("byStatusSequence")
      .between(awaitingRange.lower, awaitingRange.upper);
    for (const row of awaiting) {
      if (row.commitSequence === null || compareDecimalSequence(row.commitSequence, horizon) > 0) {
        continue;
      }
      yield* api.from("command_outbox").upsert({
        ...row,
        status: "integrated",
      });
      yield* api.from("stock_overlays").delete("byCommand").equals(row.operationId);
    }
  });

const recomputePendingOverlays = (api: QueryBuilder, generation: number) =>
  Effect.gen(function* () {
    yield* api.from("stock_overlays").clear;
    const pendingRange = statusPrefix("pending");
    const awaitingRange = statusPrefix("accepted_awaiting_integration");
    const pending = yield* api
      .from("command_outbox")
      .select("byStatusSequence")
      .between(pendingRange.lower, pendingRange.upper);
    const awaiting = yield* api
      .from("command_outbox")
      .select("byStatusSequence")
      .between(awaitingRange.lower, awaitingRange.upper);
    const rows = [...pending, ...awaiting].sort((left, right) =>
      compareDecimalSequence(left.clientSequence, right.clientSequence),
    );
    const packCache = new Map<string, number>();
    const stockCache = new Map<string, VisibleStock>();
    for (const row of rows) {
      const envelope = decodeEnvelope(row.envelopeJson);
      if (envelope.command._tag === "issueInvoice") {
        for (const take of envelope.command.payload.allocations) {
          if (!packCache.has(take.productId)) {
            const products = yield* api
              .from("products")
              .select()
              .equals([generation, take.productId]);
            packCache.set(take.productId, products[0]?.unitsPerPack ?? 1);
          }
          if (!stockCache.has(take.batchId)) {
            stockCache.set(take.batchId, yield* visibleStock(api, generation, take.batchId));
          }
        }
      }
      const overlays = decideOverlays(
        envelope,
        (productId) => packCache.get(productId) ?? 1,
        (batchId) => stockCache.get(batchId) ?? { packQuantity: 0, unitQuantity: 0 },
      );
      for (const overlay of overlays) {
        yield* api.from("stock_overlays").upsert(overlay);
        const current = stockCache.get(overlay.batchId) ?? { packQuantity: 0, unitQuantity: 0 };
        stockCache.set(overlay.batchId, {
          packQuantity: current.packQuantity + overlay.packDelta,
          unitQuantity: current.unitQuantity + overlay.unitDelta,
        });
      }
    }
  });

export const beginIndexedDbSnapshotImport = (
  api: QueryBuilder,
  activeGeneration: number,
  manifest: SnapshotManifest,
) =>
  Effect.gen(function* () {
    const existingRows = yield* api.from("snapshot_imports").select().equals(manifest.snapshotId);
    if (existingRows[0]) return;
    yield* api.from("snapshot_imports").upsert({
      snapshotId: manifest.snapshotId,
      generation: activeGeneration + 1,
      subscription: manifest.subscription,
      horizon: manifest.horizon,
      stage: "importing",
      partsImported: 0,
      partsTotal: manifest.parts.length,
    });
  });

export const importIndexedDbSnapshotPart = (
  api: QueryBuilder,
  manifest: SnapshotManifest,
  part: SnapshotPartPayload,
) =>
  Effect.gen(function* () {
    const importRows = yield* api.from("snapshot_imports").select().equals(manifest.snapshotId);
    const importRow = importRows[0];
    if (!importRow || importRow.stage === "activated") {
      return yield* Effect.fail(
        syncProtocolError("SNAPSHOT_UNAVAILABLE", "The snapshot import is not active."),
      );
    }
    const manifestPart = manifest.parts.find((entry) => entry.partNumber === part.partNumber);
    if (!manifestPart) {
      return yield* Effect.fail(
        syncProtocolError("SNAPSHOT_UNAVAILABLE", "The snapshot part is not in the manifest."),
      );
    }
    if (part.snapshotId !== manifest.snapshotId) {
      return yield* Effect.fail(
        syncProtocolError("SNAPSHOT_UNAVAILABLE", "The snapshot part identity does not match."),
      );
    }
    if (part.partNumber <= importRow.partsImported) {
      return;
    }
    if (part.partNumber !== importRow.partsImported + 1) {
      return yield* Effect.fail(
        syncProtocolError("SNAPSHOT_UNAVAILABLE", "The snapshot part arrived out of order."),
      );
    }
    for (const row of part.rows) {
      yield* stageSnapshotRow(api, manifest.snapshotId, row);
    }
    const partsImported = importRow.partsImported + 1;
    const stage = partsImported === importRow.partsTotal ? "caught_up" : "importing";
    yield* api.from("snapshot_imports").upsert({
      ...importRow,
      partsImported,
      stage,
    });
  });

export const activateIndexedDbSnapshot = (api: QueryBuilder, snapshotId: SnapshotId) =>
  Effect.gen(function* () {
    const importRows = yield* api.from("snapshot_imports").select().equals(snapshotId);
    const importRow = importRows[0];
    if (!importRow || importRow.stage !== "caught_up") {
      return yield* Effect.fail(
        syncProtocolError("SNAPSHOT_UNAVAILABLE", "The snapshot is not ready to activate."),
      );
    }
    const stateRows = yield* api.from("replica_state").select().equals("singleton");
    const state = stateRows[0];
    if (!state) {
      return yield* Effect.fail(
        syncProtocolError("SNAPSHOT_UNAVAILABLE", "Replica state is missing."),
      );
    }
    yield* promoteStagedSnapshot(api, importRow.generation, snapshotId);
    yield* integrateCoveredCommands(api, importRow.horizon);
    yield* recomputePendingOverlays(api, importRow.generation);
    const localCommitVersion = state.localCommitVersion + 1;
    yield* api.from("replica_state").upsert({
      ...state,
      activeGeneration: importRow.generation,
      appliedCommitSequence: importRow.horizon,
      localCommitVersion,
    });
    yield* api.from("replica_coverage").upsert({
      subscription: importRow.subscription,
      state: "downloaded",
      throughCommitSequence: importRow.horizon,
      digest: null,
    });
    yield* api.from("snapshot_imports").upsert({
      ...importRow,
      stage: "activated",
    });
    return {
      activeGeneration: importRow.generation,
      localCommitVersion,
      subscription: importRow.subscription,
    };
  });
