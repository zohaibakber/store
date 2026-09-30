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
import { byClientSequence, decideOverlays } from "../decisions";
import {
  reapplyIndexedDbPendingProjections,
  readIndexedDbUnitsPerPack,
  writeEntityRow,
} from "./pending";
import { outboxWithStatus, type ReplicaQueryBuilder } from "./schema";

const PROMOTE_CHUNK_ROWS = 500;

const SWEEP_CHUNK_ROWS = 500;

const MAX_GENERATION = Number.MAX_SAFE_INTEGER;

type GenerationStore =
  | "categories"
  | "products"
  | "batches"
  | "invoices"
  | "invoice_items"
  | "stock_movements";

const GENERATION_STORES: ReadonlyArray<GenerationStore> = [
  "categories",
  "products",
  "batches",
  "invoices",
  "invoice_items",
  "stock_movements",
];

type GenerationRange = readonly [[number], [number, []]];

const hasRowsIn = (api: ReplicaQueryBuilder, store: GenerationStore, range: GenerationRange) => {
  const [lower, upper] = range;
  switch (store) {
    case "categories":
      return api.from("categories").select().between(lower, upper).limit(1);
    case "products":
      return api.from("products").select().between(lower, upper).limit(1);
    case "batches":
      return api.from("batches").select().between(lower, upper).limit(1);
    case "invoices":
      return api.from("invoices").select().between(lower, upper).limit(1);
    case "invoice_items":
      return api.from("invoice_items").select().between(lower, upper).limit(1);
    case "stock_movements":
      return api.from("stock_movements").select().between(lower, upper).limit(1);
  }
};

const deleteChunkIn = (
  api: ReplicaQueryBuilder,
  store: GenerationStore,
  range: GenerationRange,
) => {
  const [lower, upper] = range;
  switch (store) {
    case "categories":
      return api.from("categories").delete().between(lower, upper).limit(SWEEP_CHUNK_ROWS);
    case "products":
      return api.from("products").delete().between(lower, upper).limit(SWEEP_CHUNK_ROWS);
    case "batches":
      return api.from("batches").delete().between(lower, upper).limit(SWEEP_CHUNK_ROWS);
    case "invoices":
      return api.from("invoices").delete().between(lower, upper).limit(SWEEP_CHUNK_ROWS);
    case "invoice_items":
      return api.from("invoice_items").delete().between(lower, upper).limit(SWEEP_CHUNK_ROWS);
    case "stock_movements":
      return api.from("stock_movements").delete().between(lower, upper).limit(SWEEP_CHUNK_ROWS);
  }
};

const unreferencedRanges = (keep: ReadonlyArray<number>): ReadonlyArray<GenerationRange> => {
  const sorted = [...new Set(keep)].sort((left, right) => left - right);
  const ranges: Array<GenerationRange> = [];
  let next = 0;
  for (const generation of sorted) {
    if (generation > next) ranges.push([[next], [generation - 1, []]]);
    next = generation + 1;
  }
  ranges.push([[next], [MAX_GENERATION, []]]);
  return ranges;
};

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
    for (const row of Array.sort([...pending, ...awaiting], byClientSequence)) {
      const envelope = yield* decodeStoredEnvelope(row);
      const unitsPerPackFor = yield* readIndexedDbUnitsPerPack(
        api,
        generation,
        envelope.command._tag === "issueInvoice"
          ? envelope.command.payload.allocations.map((take) => take.productId)
          : [],
      );
      for (const overlay of decideOverlays(envelope, unitsPerPackFor)) {
        yield* api.from("stock_overlays").upsert(overlay);
      }
    }
  });

export const abandonIndexedDbSnapshot = (api: ReplicaQueryBuilder, snapshotId: string) =>
  Effect.gen(function* () {
    const importRows = yield* api.from("snapshot_imports").select().equals(snapshotId);
    const importRow = importRows[0];
    if (!importRow || importRow.stage === "activated" || importRow.stage === "failed") return;
    yield* api.from("snapshot_imports").upsert({ ...importRow, stage: "failed" });
  });

const deleteStagedChunk = (api: ReplicaQueryBuilder, snapshotId: string) =>
  Effect.gen(function* () {
    const staged = yield* api
      .from("snapshot_staged_rows")
      .select("bySnapshot")
      .equals(snapshotId)
      .limit(1);
    if (staged.length === 0) return false;
    yield* api
      .from("snapshot_staged_rows")
      .delete("bySnapshot")
      .equals(snapshotId)
      .limit(SWEEP_CHUNK_ROWS);
    return true;
  });

export const clearAbandonedIndexedDbImportStep = (api: ReplicaQueryBuilder, snapshotId: string) =>
  Effect.gen(function* () {
    const importRows = yield* api.from("snapshot_imports").select().equals(snapshotId);
    if (importRows[0]?.stage !== "failed") return { remaining: false };
    return { remaining: yield* deleteStagedChunk(api, snapshotId) };
  });

export const beginIndexedDbSnapshotImport = (
  api: ReplicaQueryBuilder,
  activeGeneration: number,
  manifest: SnapshotManifest,
) =>
  Effect.gen(function* () {
    const imports = yield* api.from("snapshot_imports").select();
    const existing = imports.find((row) => row.snapshotId === manifest.snapshotId);
    if (existing && existing.stage !== "failed") {
      return { partsImported: existing.partsImported };
    }
    if (existing) {
      yield* api.from("snapshot_staged_rows").delete("bySnapshot").equals(manifest.snapshotId);
    }
    for (const stale of imports) {
      if (stale.stage === "importing" || stale.stage === "caught_up") {
        yield* abandonIndexedDbSnapshot(api, stale.snapshotId);
      }
    }
    const generation = Math.max(activeGeneration, ...imports.map((row) => row.generation)) + 1;
    const stage = manifest.parts.length === 0 ? "caught_up" : "importing";
    yield* api.from("snapshot_imports").upsert({
      snapshotId: manifest.snapshotId,
      generation,
      subscription: manifest.subscription,
      horizon: manifest.horizon,
      stage,
      partsImported: 0,
      partsTotal: manifest.parts.length,
    });
    return { partsImported: 0 };
  });

export const importIndexedDbSnapshotPart = (
  api: ReplicaQueryBuilder,
  manifest: SnapshotManifest,
  part: SnapshotPartPayload,
) =>
  Effect.gen(function* () {
    const importRows = yield* api.from("snapshot_imports").select().equals(manifest.snapshotId);
    const importRow = importRows[0];
    if (!importRow || importRow.stage === "activated" || importRow.stage === "failed") {
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

export const promoteIndexedDbSnapshotChunk = (api: ReplicaQueryBuilder, snapshotId: SnapshotId) =>
  Effect.gen(function* () {
    const importRows = yield* api.from("snapshot_imports").select().equals(snapshotId);
    const importRow = importRows[0];
    if (!importRow || importRow.stage !== "caught_up") {
      return yield* Effect.fail(
        syncProtocolError("SNAPSHOT_UNAVAILABLE", "The snapshot is not ready to activate."),
      );
    }
    const staged = yield* api
      .from("snapshot_staged_rows")
      .select("bySnapshot")
      .equals(snapshotId)
      .limit(PROMOTE_CHUNK_ROWS);
    for (const row of staged) {
      yield* writeEntityRow(
        api,
        importRow.generation,
        decodeEntity(row.entity),
        decodeRowJson(row.rowJson),
      );
      yield* api
        .from("snapshot_staged_rows")
        .delete()
        .equals([snapshotId, row.entity, row.entityId]);
    }
    return { remaining: staged.length === PROMOTE_CHUNK_ROWS };
  });

export const switchIndexedDbSnapshot = (api: ReplicaQueryBuilder, snapshotId: SnapshotId) =>
  Effect.gen(function* () {
    const importRows = yield* api.from("snapshot_imports").select().equals(snapshotId);
    const importRow = importRows[0];
    if (!importRow || importRow.stage !== "caught_up") {
      return yield* Effect.fail(
        syncProtocolError("SNAPSHOT_UNAVAILABLE", "The snapshot is not ready to activate."),
      );
    }
    const unpromoted = yield* api
      .from("snapshot_staged_rows")
      .select("bySnapshot")
      .equals(snapshotId)
      .limit(1);
    if (unpromoted.length > 0) {
      return yield* Effect.fail(
        syncProtocolError("SNAPSHOT_UNAVAILABLE", "The snapshot rows are not fully promoted."),
      );
    }
    const stateRows = yield* api.from("replica_state").select().equals("singleton");
    const state = stateRows[0];
    if (!state) {
      return yield* Effect.fail(
        syncProtocolError("SNAPSHOT_UNAVAILABLE", "Replica state is missing."),
      );
    }
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
      verifiedAt: null,
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

export const sweepIndexedDbStorageStep = (api: ReplicaQueryBuilder) =>
  Effect.gen(function* () {
    const stateRows = yield* api.from("replica_state").select().equals("singleton");
    const state = stateRows[0];
    if (!state) return { remaining: false };
    const imports = yield* api.from("snapshot_imports").select();
    const keep = [
      state.activeGeneration,
      ...imports
        .filter((row) => row.stage === "importing" || row.stage === "caught_up")
        .map((row) => row.generation),
    ];
    for (const range of unreferencedRanges(keep)) {
      for (const store of GENERATION_STORES) {
        if ((yield* hasRowsIn(api, store, range)).length > 0) {
          yield* deleteChunkIn(api, store, range);
          return { remaining: true };
        }
      }
    }
    for (const row of imports) {
      if (row.stage !== "failed" && row.stage !== "activated") continue;
      if (yield* deleteStagedChunk(api, row.snapshotId)) return { remaining: true };
    }
    return { remaining: false };
  });
