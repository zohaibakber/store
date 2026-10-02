import {
  compareDecimalSequence,
  syncProtocolError,
  type SnapshotId,
  type SnapshotManifest,
  type SnapshotPartPayload,
} from "@store/contracts";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";

import { decodeEntity, decodeRowJson, decodeStoredEnvelope } from "../codecs";
import { byClientSequence, decideOverlays, decidePartAdmission } from "../decisions";
import {
  reapplyIndexedDbPendingProjections,
  readIndexedDbUnitsPerPack,
  writeEntityRow,
  writeEntityRows,
} from "./pending";
import { ENTITY_STORES, outboxWithStatus, type ReplicaQueryBuilder } from "./schema";

const PROMOTE_CHUNK_ROWS = 500;

const SWEEP_CHUNK_ROWS = 500;

const MAX_GENERATION = Number.MAX_SAFE_INTEGER;

type GenerationStore = (typeof ENTITY_STORES)[number];

type GenerationRange = readonly [[number], [number, []]];

const hasRowsIn = (api: ReplicaQueryBuilder, store: GenerationStore, range: GenerationRange) => {
  const [lower, upper] = range;
  return api.from(store).select().between(lower, upper).limit(1);
};

const deleteChunkIn = (
  api: ReplicaQueryBuilder,
  store: GenerationStore,
  range: GenerationRange,
) => {
  const [lower, upper] = range;
  return api.from(store).delete().between(lower, upper).limit(SWEEP_CHUNK_ROWS);
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
    const admission = yield* Effect.fromResult(decidePartAdmission(importRows[0], manifest, part));
    if (admission._tag === "imported") return;
    const { importRow } = admission;
    const byEntity = Array.groupBy(part.rows, (row) => decodeEntity(row.entity));
    for (const [entity, rows] of Object.entries(byEntity)) {
      yield* writeEntityRows(
        api,
        importRow.generation,
        decodeEntity(entity),
        rows.map((row) => row.row),
      );
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
      for (const store of ENTITY_STORES) {
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
