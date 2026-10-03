import type { D1Database } from "@cloudflare/workers-types";
import * as D1Client from "@effect/sql-d1/D1Client";
import { sql, type Column } from "drizzle-orm";
import * as D1Drizzle from "drizzle-orm/effect-d1";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export type AuthDrizzle = Effect.Success<ReturnType<typeof D1Drizzle.makeWithDefaults>>;

export class AuthD1 extends Context.Service<AuthD1, AuthDrizzle>()("@store/auth-worker/AuthD1") {
  static readonly layer = (database: D1Database) =>
    Layer.effect(AuthD1, D1Drizzle.makeWithDefaults({})).pipe(
      Layer.provide(D1Client.layer({ db: database })),
    );
}

type Stored<C extends Column> = C["_"]["notNull"] extends true
  ? C["_"]["data"]
  : C["_"]["data"] | null;

export const bound = <C extends Column>(column: C, value: Stored<C>) =>
  sql<Stored<C>>`${sql.param(value, column)}`.as(column.name);

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
