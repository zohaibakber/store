import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import * as Effect from "effect/Effect";

export const AuthDatabase = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const schema = yield* Drizzle.Schema("AuthSchema", {
    schema: "packages/db/src/auth/schema.ts",
    out: "packages/db/migrations/auth",
    dialect: "sqlite",
  });

  // Alchemy ignores `table` on the `{ out }` (Drizzle.Schema) form; the
  // bookkeeping table is the one each stage's state already records.
  return yield* Cloudflare.D1.Database("AuthDatabase", {
    migrations: schema,
  }).pipe(RemovalPolicy.retain(stage === "prod"));
});
