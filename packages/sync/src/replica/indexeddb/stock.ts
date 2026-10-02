import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";

import {
  withPendingOverlays,
  type SequencedOverlay,
  type StockOverlayDelta,
  type VisibleStock,
} from "../decisions";
import type { IndexedDbSubsetRow } from "./query";
import type { ReplicaQueryBuilder } from "./schema";

type BatchOverlays = {
  readonly overlays: ReadonlyArray<SequencedOverlay>;
  readonly absoluteSequence: string | undefined;
};

type VisibleStockContext = ReadonlyMap<string, BatchOverlays>;

const sequenceOf = (api: ReplicaQueryBuilder, operationId: string) =>
  api
    .from("command_outbox")
    .select()
    .equals(operationId)
    .pipe(Effect.map((rows) => rows[0]?.clientSequence));

const absoluteSequenceOf = (api: ReplicaQueryBuilder, batchId: string) =>
  Effect.gen(function* () {
    const [mark] = yield* api.from("pending_row_marks").select().equals(["batch", batchId]);
    return mark ? yield* sequenceOf(api, mark.operationId) : undefined;
  });

const contextOf = (
  api: ReplicaQueryBuilder,
  overlays: ReadonlyArray<StockOverlayDelta>,
): Effect.Effect<VisibleStockContext, unknown> =>
  Effect.gen(function* () {
    const sequences = new Map<string, string | undefined>();
    const byBatch = new Map<string, Array<StockOverlayDelta>>();
    for (const overlay of overlays) {
      if (!sequences.has(overlay.commandId)) {
        sequences.set(overlay.commandId, yield* sequenceOf(api, overlay.commandId));
      }
      const grouped = byBatch.get(overlay.batchId);
      if (grouped === undefined) byBatch.set(overlay.batchId, [overlay]);
      else grouped.push(overlay);
    }
    const context = new Map<string, BatchOverlays>();
    for (const [batchId, batchOverlays] of byBatch) {
      context.set(batchId, {
        overlays: batchOverlays.map((overlay) => ({
          packDelta: overlay.packDelta,
          unitDelta: overlay.unitDelta,
          clientSequence: sequences.get(overlay.commandId),
        })),
        absoluteSequence: yield* absoluteSequenceOf(api, batchId),
      });
    }
    return context;
  });

export const readVisibleStockContext = (
  api: ReplicaQueryBuilder,
): Effect.Effect<VisibleStockContext, unknown> =>
  api
    .from("stock_overlays")
    .select()
    .pipe(Effect.flatMap((overlays) => contextOf(api, overlays)));

const readVisibleStockContextOf = (
  api: ReplicaQueryBuilder,
  batchIds: Iterable<string>,
): Effect.Effect<VisibleStockContext, unknown> =>
  Effect.forEach(new Set(batchIds), (batchId) =>
    api.from("stock_overlays").select("byBatch").equals(batchId),
  ).pipe(Effect.flatMap((overlays) => contextOf(api, overlays.flat())));

const visibleStockOf = (base: VisibleStock, batch: BatchOverlays | undefined): VisibleStock =>
  batch === undefined ? base : withPendingOverlays(base, batch.overlays, batch.absoluteSequence);

export const withVisibleStock = <Row extends VisibleStock & { readonly id: string }>(
  row: Row,
  context: VisibleStockContext,
): Row => {
  const batch = context.get(row.id);
  return batch === undefined ? row : { ...row, ...visibleStockOf(row, batch) };
};

const stockCellsOf = (row: IndexedDbSubsetRow) => {
  const id = row["id"];
  const packQuantity = row["packQuantity"];
  const unitQuantity = row["unitQuantity"];
  return Predicate.isString(id) &&
    Predicate.isNumber(packQuantity) &&
    Predicate.isNumber(unitQuantity)
    ? { id, packQuantity, unitQuantity }
    : undefined;
};

export const withVisibleStockRows = (
  api: ReplicaQueryBuilder,
  rows: ReadonlyArray<IndexedDbSubsetRow>,
): Effect.Effect<ReadonlyArray<IndexedDbSubsetRow>, unknown> =>
  Effect.gen(function* () {
    const stocked = rows.flatMap((row) => {
      const cells = stockCellsOf(row);
      return cells === undefined ? [] : [cells.id];
    });
    if (stocked.length === 0) return rows;
    const context = yield* readVisibleStockContextOf(api, stocked);
    return rows.map((row) => {
      const cells = stockCellsOf(row);
      return cells === undefined ? row : withVisibleStock({ ...row, ...cells }, context);
    });
  });

export const readVisibleStock = (
  api: ReplicaQueryBuilder,
  batchRows: ReadonlyArray<VisibleStock & { readonly id: string }>,
): Effect.Effect<ReadonlyMap<string, VisibleStock>, unknown> =>
  readVisibleStockContextOf(
    api,
    batchRows.map((batch) => batch.id),
  ).pipe(
    Effect.map(
      (context) =>
        new Map<string, VisibleStock>(
          batchRows.map((batch) => [batch.id, visibleStockOf(batch, context.get(batch.id))]),
        ),
    ),
  );
