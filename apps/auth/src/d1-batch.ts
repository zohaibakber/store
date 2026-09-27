import type * as D1Drizzle from "drizzle-orm/effect-d1";
import type * as Effect from "effect/Effect";

export type AuthDrizzle = Effect.Success<ReturnType<typeof D1Drizzle.makeWithDefaults>>;

export interface CompilableQuery {
  readonly toSQL: () => { readonly sql: string; readonly params: ReadonlyArray<unknown> };
}

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
