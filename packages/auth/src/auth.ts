import { electron } from "@better-auth/electron";
import type { AuthDatabase } from "@store/db/auth.database";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";

export interface AuthConfig {
  readonly baseURL: string;
  readonly database: AuthDatabase;
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
    database: {
      db: config.database,
      type: "postgres",
      transaction: true,
    },
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
