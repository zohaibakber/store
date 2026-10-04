import * as Effect from "effect/Effect";

import { UnsupportedSubsetQuery } from "./errors";
import { MAX_BATCH_ROWS, MAX_BATCH_SPECS } from "./sources";
import type { InventorySubsetSpec } from "./subset-spec";

export const rejectColumn = (column: string) =>
  new UnsupportedSubsetQuery({
    message: `Unsupported subset query: column ${column} is not allowlisted`,
    reason: `column ${column} is not allowlisted`,
  });

export const allowlisted = (
  column: string,
  columns: ReadonlySet<string>,
): Effect.Effect<string, UnsupportedSubsetQuery> =>
  columns.has(column) ? Effect.succeed(column) : Effect.fail(rejectColumn(column));

export const validateBatchSpecs = (specs: ReadonlyArray<InventorySubsetSpec>) =>
  specs.length === 0 ||
  specs.length > MAX_BATCH_SPECS ||
  specs.some((spec) => spec.limit > MAX_BATCH_ROWS)
    ? Effect.fail(
        new UnsupportedSubsetQuery({
          message: `Unsupported batch read: at most ${MAX_BATCH_SPECS} specifications of ${MAX_BATCH_ROWS} rows`,
          reason: `batch of ${specs.length} specifications exceeds the bound`,
        }),
      )
    : Effect.void;
