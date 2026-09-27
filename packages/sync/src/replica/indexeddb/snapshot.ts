import {
  compareDecimalSequence,
  syncProtocolError,
  type SnapshotId,
  type SnapshotManifest,
  type SnapshotPartPayload,
} from "@store/contracts";
import { replicaEntitySchemas } from "@store/contracts/sync/replica-model";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { decodeEntity, decodeRowJson, decodeStoredEnvelope, encodeRowJson } from "../codecs";
import { byClientSequence, byEntityDependency, decideOverlays } from "../decisions";
import { reapplyIndexedDbPendingProjections, writeEntityRow } from "./pending";
import { generationBounds } from "./query";
import { outboxWithStatus, type ReplicaQueryBuilder } from "./schema";
import { makeIndexedDbStockCache } from "./stock";

const stageSnapshotRow = (
  api: ReplicaQueryBuilder,
  snapshotId: string,
  row: SnapshotPartPayload["rows"][number],
) =>
  Effect.gen(function* () {
    const entity = decodeEntity(row.entity);
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

const promoteStagedSnapshot = (api: ReplicaQueryBuilder, generation: number, snapshotId: string) =>
  Effect.gen(function* () {
    const staged = Array.sort(
      (yield* api.from("snapshot_staged_rows").select("bySnapshot").equals(snapshotId)).map(
        (row) => ({ entity: decodeEntity(row.entity), rowJson: row.rowJson }),
      ),
      byEntityDependency,
    );
    for (const row of staged) {
      yield* writeEntityRow(api, generation, row.entity, decodeRowJson(row.rowJson));
    }
    yield* api.from("snapshot_staged_rows").delete("bySnapshot").equals(snapshotId);
  });

const carryLocalHistory = (api: ReplicaQueryBuilder, from: number, to: number) =>
  Effect.gen(function* () {
    if (from === to) return;
    const [lower, upper] = generationBounds(from);
    const invoices = yield* api.from("invoices").select().between(lower, upper);
    const items = yield* api.from("invoice_items").select().between(lower, upper);
    const movements = yield* api.from("stock_movements").select().between(lower, upper);
    for (const row of invoices) yield* api.from("invoices").upsert({ ...row, generation: to });
    for (const row of items) yield* api.from("invoice_items").upsert({ ...row, generation: to });
    for (const row of movements) {
      yield* api.from("stock_movements").upsert({ ...row, generation: to });
    }
    yield* api.from("categories").delete().between(lower, upper);
    yield* api.from("products").delete().between(lower, upper);
    yield* api.from("batches").delete().between(lower, upper);
    yield* api.from("invoices").delete().between(lower, upper);
    yield* api.from("invoice_items").delete().between(lower, upper);
    yield* api.from("stock_movements").delete().between(lower, upper);
  });

const integrateCoveredCommands = (api: ReplicaQueryBuilder, horizon: string) =>
  Effect.gen(function* () {
    const awaiting = yield* outboxWithStatus(api, "accepted_awaiting_integration");
    for (const row of awaiting) {
      if (row.commitSequence === null || compareDecimalSequence(row.commitSequence, horizon) > 0) {
        continue;
      }
      yield* api.from("command_outbox").upsert({ ...row, status: "integrated" });
      yield* api.from("stock_overlays").delete("byCommand").equals(row.operationId);
    }
  });

const recomputePendingOverlays = (api: ReplicaQueryBuilder, generation: number) =>
  Effect.gen(function* () {
    yield* api.from("stock_overlays").clear;
    const pending = yield* outboxWithStatus(api, "pending");
    const awaiting = yield* outboxWithStatus(api, "accepted_awaiting_integration");
    const stock = makeIndexedDbStockCache(api, generation);
    for (const row of Array.sort([...pending, ...awaiting], byClientSequence)) {
      const envelope = yield* decodeStoredEnvelope(row);
      yield* stock.load(envelope);
      for (const overlay of decideOverlays(envelope, stock.unitsPerPackFor, stock.stockFor)) {
        yield* api.from("stock_overlays").upsert(overlay);
        stock.applyOverlay(overlay);
      }
    }
  });

export const beginIndexedDbSnapshotImport = (
  api: ReplicaQueryBuilder,
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
  api: ReplicaQueryBuilder,
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

export const activateIndexedDbSnapshot = (api: ReplicaQueryBuilder, snapshotId: SnapshotId) =>
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
    yield* carryLocalHistory(api, state.activeGeneration, importRow.generation);
    yield* integrateCoveredCommands(api, importRow.horizon);
    yield* recomputePendingOverlays(api, importRow.generation);
    yield* reapplyIndexedDbPendingProjections(api, importRow.generation, {
      organizationId: state.organizationId,
      userId: state.userId,
    });
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
