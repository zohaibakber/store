import * as PgClient from "@effect/sql-pg/PgClient";
import { inventoryState } from "@store/db/postgres/schema";
import { eq } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startAuthorityPostgres, type AuthorityPostgres } from "../inventory/authority-postgres";
import { countStatements } from "./statement-count";

let database: AuthorityPostgres;

const run = <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        PgClient.layer({
          url: Redacted.make(database.connectionString),
          maxConnections: 2,
          applicationName: "tabaaq-statement-count-tests",
        }),
      ),
      Effect.scoped,
    ),
  );

describe("countStatements", () => {
  beforeAll(async () => {
    database = await startAuthorityPostgres();
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  });

  it("counts one round trip for a single statement", async () => {
    const counted = await run(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        return yield* countStatements(sql<{ readonly one: number }>`select 1 as one`);
      }),
    );
    expect(counted.result).toEqual([{ one: 1 }]);
    expect(counted.statements).toBe(1);
    expect(counted.transactions).toBe(0);
    expect(counted.roundTrips).toBe(1);
    expect(counted.sql).toEqual(["select 1 as one"]);
  });

  it("counts Drizzle queries and transaction control statements", async () => {
    const counted = await run(
      Effect.gen(function* () {
        const db = yield* PgDrizzle.makeWithDefaults();
        return yield* countStatements(
          db.transaction((tx) =>
            Effect.all([
              tx.select().from(inventoryState).where(eq(inventoryState.organizationId, "org-a")),
              tx.select().from(inventoryState).where(eq(inventoryState.organizationId, "org-b")),
            ]),
          ),
        );
      }),
    );
    expect(counted.result).toEqual([[], []]);
    expect(counted.statements).toBe(2);
    expect(counted.transactions).toBe(1);
    expect(counted.roundTrips).toBe(4);
  });

  it("scopes counts to the wrapped effect", async () => {
    const counted = await run(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient;
        yield* sql`select 1`;
        const inner = yield* countStatements(sql`select 2`);
        yield* sql`select 3`;
        return inner;
      }),
    );
    expect(counted.statements).toBe(1);
    expect(counted.sql).toEqual(["select 2"]);
  });
});
