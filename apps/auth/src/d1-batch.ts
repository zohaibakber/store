import type * as D1Drizzle from "drizzle-orm/effect-d1";
import type * as Effect from "effect/Effect";

/** The Drizzle database over the auth worker's D1 binding. */
export type AuthDrizzle = Effect.Success<ReturnType<typeof D1Drizzle.makeWithDefaults>>;

/** A Drizzle query builder that compiles to one SQL statement. */
export interface CompilableQuery {
  readonly toSQL: () => { readonly sql: string; readonly params: ReadonlyArray<unknown> };
}

/**
 * D1 has no transactions, only atomic batches. Compiles each Drizzle query
 * builder and sends them all as one batch request, which answers every
 * statement's rows in order.
 */
export const runD1Batch = <Row extends object>(
  database: AuthDrizzle,
  queries: ReadonlyArray<CompilableQuery>,
) => {
  const client = database.$client;
  return client.batch(
    queries.map((query) => {
      const compiled = query.toSQL();
      return client.unsafe<Row>(compiled.sql, compiled.params);
    }),
  );
};
