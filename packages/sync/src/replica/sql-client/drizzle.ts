import { entityKind } from "drizzle-orm";
import { EffectCache } from "drizzle-orm/cache/core/cache-effect";
import type { WithCacheConfig } from "drizzle-orm/cache/core/types";
import { DefaultServices } from "drizzle-orm/effect-core/defaults";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import { EffectLogger } from "drizzle-orm/effect-core/logger";
import type { QueryEffectHKTBase } from "drizzle-orm/effect-core/query-effect";
import type { EmptyRelations } from "drizzle-orm/relations";
import type { Query } from "drizzle-orm/sql/sql";
import { SQLiteDialect } from "drizzle-orm/sqlite-core/dialect";
import { SQLiteEffectDatabase } from "drizzle-orm/sqlite-core/effect/db";
import {
  SQLiteEffectPreparedQuery,
  SQLiteEffectSession,
  SQLiteEffectTransaction,
} from "drizzle-orm/sqlite-core/effect/session";
import type { PreparedQueryConfig, SQLiteExecuteMethod } from "drizzle-orm/sqlite-core/session";
import * as Effect from "effect/Effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";
import type { Row } from "effect/unstable/sql/SqlConnection";
import type { SqlError } from "effect/unstable/sql/SqlError";

export interface ReplicaQueryEffectHKT extends QueryEffectHKTBase {
  readonly error: EffectDrizzleQueryError;
  readonly context: never;
}

export type ReplicaDb = SQLiteEffectDatabase<ReplicaQueryEffectHKT, unknown, EmptyRelations>;

type QueryMode = "arrays" | "objects" | "raw";

type QueryMetadata = {
  readonly type: "select" | "update" | "delete" | "insert";
  readonly tables: Array<string>;
};

type SessionServices = {
  readonly logger: EffectLogger["Service"];
  readonly cache: EffectCache["Service"];
};

const copyRow = (row: Row | undefined) => (row === undefined ? row : { ...row });

class SqlClientSession extends SQLiteEffectSession<unknown, ReplicaQueryEffectHKT, EmptyRelations> {
  static readonly [entityKind]: string = "StoreSqlClientSession";

  constructor(
    private readonly client: SqlClient,
    dialect: SQLiteDialect,
    private readonly services: SessionServices,
  ) {
    super(dialect);
  }

  prepareQuery<T extends PreparedQueryConfig = PreparedQueryConfig>(
    query: Query,
    mode: QueryMode,
    _prepare: boolean,
    executeMethod?: SQLiteExecuteMethod,
    mapper?: (rows: Array<any>) => any,
    queryMetadata?: QueryMetadata,
    cacheConfig?: WithCacheConfig,
  ): SQLiteEffectPreparedQuery<T, ReplicaQueryEffectHKT> {
    const statement = (params: Array<unknown>) => this.client.unsafe<Row>(query.sql, params);
    return new SQLiteEffectPreparedQuery(
      executeMethod,
      {
        all: (params) => {
          const q = statement(params);
          if (mode === "arrays") return q.values;
          if (mode === "objects")
            return Effect.map(q.withoutTransform, (rows) => rows.map(copyRow));
          return q.withoutTransform;
        },
        get: (params) => {
          const q = statement(params);
          if (mode === "arrays") return Effect.map(q.values, (rows) => rows[0]);
          if (mode === "objects") return Effect.map(q.withoutTransform, (rows) => copyRow(rows[0]));
          return Effect.map(q.withoutTransform, (rows) => rows[0]);
        },
        values: (params) => statement(params).values,
        run: (params) => statement(params).raw,
      },
      query,
      mapper,
      mode,
      this.services.logger,
      this.services.cache,
      queryMetadata,
      cacheConfig,
    );
  }

  transaction<A, E, R>(
    transaction: (
      tx: SQLiteEffectTransaction<ReplicaQueryEffectHKT, unknown, EmptyRelations>,
    ) => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | SqlError, R> {
    return this.client.withTransaction(
      Effect.suspend(() => transaction(new SqlClientTransaction(this.dialect, this, {}))),
    );
  }
}

class SqlClientTransaction extends SQLiteEffectTransaction<
  ReplicaQueryEffectHKT,
  unknown,
  EmptyRelations
> {
  static readonly [entityKind]: string = "StoreSqlClientTransaction";
}

class SqlClientDatabase extends SQLiteEffectDatabase<
  ReplicaQueryEffectHKT,
  unknown,
  EmptyRelations
> {
  static readonly [entityKind]: string = "StoreSqlClientDatabase";
}

export const makeReplicaDb = (client: SqlClient): Effect.Effect<ReplicaDb> =>
  Effect.gen(function* () {
    const logger = yield* EffectLogger;
    const cache = yield* EffectCache;
    const dialect = new SQLiteDialect({ useJitMappers: false });
    return new SqlClientDatabase(
      dialect,
      new SqlClientSession(client, dialect, { logger, cache }),
      {},
    );
  }).pipe(Effect.provide(DefaultServices));
