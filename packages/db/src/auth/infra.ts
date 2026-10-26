import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Drizzle from "@alchemy.run/drizzle";
import * as Alchemy from "alchemy";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import * as Effect from "effect/Effect";

export const AuthDatabase = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const schema = yield* Drizzle.Schema("AuthSchema", {
    schema: "packages/db/src/auth/schema.ts",
    out: "packages/db/migrations/auth",
    dialect: "sqlite",
  });
  return yield* Cloudflare.D1.Database("AuthDatabase", {
    name: stage === "prod" ? "Tabaaq-AuthDatabase-prod-za4i7ph2otmfoagi" : undefined,
    migrations: { dir: schema.out, table: "drizzle_migrations" },
  }).pipe(RemovalPolicy.retain(stage === "prod"));
});

export const AuthSigningKeyPair = Alchemy.KeyPair("AuthSigningKeyPair", {
  algorithm: "ec",
  namedCurve: "P-256",
});

export const AuthEphemeralSecret = Alchemy.Random("AuthEphemeralSecret", { bytes: 32 });
