import * as Effect from "effect/Effect";

import { UnsupportedSubsetQuery } from "./errors";

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
