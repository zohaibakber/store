import type { SyncCommandEnvelope } from "@store/contracts";
import * as Effect from "effect/Effect";

import { EMPTY_STOCK, withOverlays, type StockOverlayDelta, type VisibleStock } from "../decisions";
import type { ReplicaQueryBuilder } from "./schema";

export type IndexedDbStockCache = {
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
            stock.set(take.batchId, withOverlays(batches[0] ?? EMPTY_STOCK, overlays));
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
