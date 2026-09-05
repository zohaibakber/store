import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { PostgresDrizzle, PostgresTransaction } from "./mutation-database";

export const withCatalogTransaction = <A, E, R>(
  db: PostgresDrizzle,
  organizationId: string,
  operation: (transaction: PostgresTransaction) => Effect.Effect<A, E, R>,
) =>
  db.transaction((tx) =>
    tx
      .execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`catalog-commit:${organizationId}`}, 0))`,
      )
      .pipe(Effect.andThen(() => operation(tx))),
  );
