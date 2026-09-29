import type { SyncCommandEnvelope } from "@store/contracts";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";

import {
  EMPTY_STOCK,
  withOverlays,
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

export type VisibleStockContext = ReadonlyMap<string, BatchOverlays>;

const sequenceOf = (api: ReplicaQueryBuilder, operationId: string) =>
  api
    .from("command_outbox")
    .select()
    .equals(operationId)
    .pipe(Effect.map((rows) => rows[0]?.clientSequence));

const readBatchOverlays = (
  api: ReplicaQueryBuilder,
  batchId: string,
  overlays: ReadonlyArray<StockOverlayDelta>,
): Effect.Effect<BatchOverlays, unknown> =>
  Effect.gen(function* () {
    const [mark] = yield* api.from("pending_row_marks").select().equals(["batch", batchId]);
    const absoluteSequence = mark ? yield* sequenceOf(api, mark.operationId) : undefined;
    const sequenced = yield* Effect.forEach(overlays, (overlay) =>
      sequenceOf(api, overlay.commandId).pipe(
        Effect.map((clientSequence) => ({
          packDelta: overlay.packDelta,
          unitDelta: overlay.unitDelta,
          clientSequence,
        })),
      ),
    );
    return { overlays: sequenced, absoluteSequence };
  });

const visibleStockOf = (base: VisibleStock, batch: BatchOverlays | undefined): VisibleStock =>
  batch === undefined ? base : withPendingOverlays(base, batch.overlays, batch.absoluteSequence);

export const readVisibleStockContext = (
  api: ReplicaQueryBuilder,
): Effect.Effect<VisibleStockContext, unknown> =>
  Effect.gen(function* () {
    const overlays = yield* api.from("stock_overlays").select();
    const grouped = Array.groupBy(overlays, (overlay) => overlay.batchId);
    const entries = yield* Effect.forEach(Object.entries(grouped), ([batchId, batchOverlays]) =>
      readBatchOverlays(api, batchId, batchOverlays).pipe(
        Effect.map((batch) => [batchId, batch] as const),
      ),
    );
    return new Map(entries);
  });

export const withVisibleStock = <Row extends VisibleStock & { readonly id: string }>(
  row: Row,
  context: VisibleStockContext,
): Row => {
  const batch = context.get(row.id);
  return batch === undefined ? row : { ...row, ...visibleStockOf(row, batch) };
};

export const withVisibleStockCells = (
  row: IndexedDbSubsetRow,
  context: VisibleStockContext,
): IndexedDbSubsetRow => {
  const id = row["id"];
  const packQuantity = row["packQuantity"];
  const unitQuantity = row["unitQuantity"];
  if (
    !Predicate.isString(id) ||
    !Predicate.isNumber(packQuantity) ||
    !Predicate.isNumber(unitQuantity)
  ) {
    return row;
  }
  return withVisibleStock({ ...row, id, packQuantity, unitQuantity }, context);
};

type IndexedDbStockCache = {
  readonly load: (envelope: SyncCommandEnvelope) => Effect.Effect<void, unknown>;
  readonly unitsPerPackFor: (productId: string) => number;
  readonly stockFor: (batchId: string) => VisibleStock;
  readonly applyOverlay: (overlay: StockOverlayDelta) => void;
};

export const makeIndexedDbStockCache = (
  api: ReplicaQueryBuilder,
  generation: number,
): IndexedDbStockCache => {
  const unitsPerPack = new Map<string, number>();
  const stock = new Map<string, VisibleStock>();
  const stockFor = (batchId: string) => stock.get(batchId) ?? EMPTY_STOCK;
  return {
    load: (envelope) =>
      Effect.gen(function* () {
        if (envelope.command._tag !== "issueInvoice") return;
        for (const take of envelope.command.payload.allocations) {
          if (!unitsPerPack.has(take.productId)) {
            const products = yield* api
              .from("products")
              .select()
              .equals([generation, take.productId]);
            unitsPerPack.set(take.productId, products[0]?.unitsPerPack ?? 1);
          }
          if (!stock.has(take.batchId)) {
            const batches = yield* api.from("batches").select().equals([generation, take.batchId]);
            const overlays = yield* api
              .from("stock_overlays")
              .select("byBatch")
              .equals(take.batchId);
            const batch = yield* readBatchOverlays(api, take.batchId, overlays);
            stock.set(take.batchId, visibleStockOf(batches[0] ?? EMPTY_STOCK, batch));
          }
        }
      }),
    unitsPerPackFor: (productId) => unitsPerPack.get(productId) ?? 1,
    stockFor,
    applyOverlay: (overlay) => {
      stock.set(overlay.batchId, withOverlays(stockFor(overlay.batchId), [overlay]));
    },
  };
};
