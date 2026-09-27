import type { OrganizationId } from "@store/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { SourceError } from "./errors.ts";
import { type BusinessTable, type DriverRow, DriverRow as DriverRowSchema } from "./model.ts";

interface SourceCatalogApi {
  readonly identity: () => Effect.Effect<string, SourceError>;
  readonly withSnapshot: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | SourceError, R>;
  readonly readPage: (
    organizationId: OrganizationId,
    table: BusinessTable,
    afterId: string,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<DriverRow>, SourceError>;
}

export class SourceCatalog extends Context.Service<SourceCatalog, SourceCatalogApi>()(
  "@store/migrate/SourceCatalog",
) {}

export type SourceTableRows = {
  readonly categories: ReadonlyArray<DriverRow>;
  readonly products: ReadonlyArray<DriverRow>;
  readonly batches: ReadonlyArray<DriverRow>;
  readonly invoices: ReadonlyArray<DriverRow>;
  readonly invoice_items: ReadonlyArray<DriverRow>;
  readonly stock_movements: ReadonlyArray<DriverRow>;
};

const decodeDriverRows = Schema.decodeUnknownSync(Schema.Array(DriverRowSchema));

const rowId = (row: DriverRow): string => {
  const id = Schema.decodeUnknownOption(Schema.String)(row.id);
  return Option.isSome(id) ? id.value : "";
};

const sortById = (rows: ReadonlyArray<DriverRow>): ReadonlyArray<DriverRow> =>
  [...rows].sort((left, right) => {
    const leftKey = rowId(left);
    const rightKey = rowId(right);
    if (leftKey < rightKey) return -1;
    if (leftKey > rightKey) return 1;
    return 0;
  });

export const inMemorySourceLayer = (input: {
  readonly identity: string;
  readonly rows: SourceTableRows;
}): Layer.Layer<SourceCatalog> =>
  Layer.effect(
    SourceCatalog,
    Effect.gen(function* () {
      const frozen = yield* Ref.make<SourceTableRows | null>(null);
      const live = input.rows;
      const capture = Effect.sync((): SourceTableRows => ({
        categories: decodeDriverRows(live.categories),
        products: decodeDriverRows(live.products),
        batches: decodeDriverRows(live.batches),
        invoices: decodeDriverRows(live.invoices),
        invoice_items: decodeDriverRows(live.invoice_items),
        stock_movements: decodeDriverRows(live.stock_movements),
      }));
      return SourceCatalog.of({
        identity: () => Effect.succeed(input.identity),
        withSnapshot: (effect) =>
          Effect.acquireUseRelease(
            capture.pipe(Effect.flatMap((snapshot) => Ref.set(frozen, snapshot))),
            () => effect,
            () => Ref.set(frozen, null),
          ).pipe(Effect.withSpan("Migrate.Source.withSnapshot")),
        readPage: Effect.fn("Migrate.Source.readPage")(function* (
          organizationId: OrganizationId,
          table: BusinessTable,
          afterId: string,
          limit: number,
        ) {
          const snapshot = yield* Ref.get(frozen);
          if (snapshot === null) {
            return yield* Effect.fail(
              new SourceError({
                operation: "readPage",
                message: "Source reads require a snapshot.",
              }),
            );
          }
          const page: Array<DriverRow> = [];
          for (const row of sortById(snapshot[table])) {
            if (row.organizationId !== organizationId) continue;
            const id = Schema.decodeUnknownOption(Schema.String)(row.id);
            if (Option.isNone(id)) continue;
            if (afterId.length > 0 && id.value <= afterId) continue;
            page.push(row);
            if (page.length >= limit) break;
          }
          return page;
        }),
      });
    }),
  );
