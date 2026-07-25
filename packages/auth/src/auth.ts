import { electron } from "@better-auth/electron";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";

export interface AuthConfig {
  readonly baseURL: string;
  readonly database: D1Database;
  readonly electronProtocol: string;
  readonly secret: string;
  readonly trustedOrigins: ReadonlyArray<string>;
}

export const makeAuth = (config: AuthConfig) => {
  const trustedOrigins = [config.baseURL, ...config.trustedOrigins, `${config.electronProtocol}:/`];

  return betterAuth({
    appName: "Store",
    baseURL: config.baseURL,
    secret: config.secret,
    // Passing the D1 binding directly lets Better Auth's kysely adapter select
    // its built-in D1SqliteDialect. That path reports no transaction support,
    // which is correct: D1 has no interactive transactions.
    database: config.database,
    emailAndPassword: { enabled: true },
    trustedOrigins,
    plugins: [
      organization({
        creatorRole: "owner",
        membershipLimit: 100,
      }),
      electron({ clientID: "store-electron", disableOriginOverride: true }),
    ],
  });
};

export type StoreAuth = ReturnType<typeof makeAuth>;
export type AuthSession = StoreAuth["$Infer"]["Session"];
