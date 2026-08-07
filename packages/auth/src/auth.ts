import { electron } from "@better-auth/electron";
import { betterAuth } from "better-auth";
import { bearer, organization } from "better-auth/plugins";

import { resolveAuthSecurity } from "./security";

export interface AuthAuditEvent {
  readonly event:
    | "auth.account.linked"
    | "auth.session.created"
    | "auth.session.revoked"
    | "auth.user.created";
  readonly userId: string;
  readonly sessionId?: string;
  readonly providerId?: string;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface AuthConfig {
  readonly audit?: (event: AuthAuditEvent) => void | Promise<void>;
  readonly baseURL: string;
  readonly database: D1Database;
  readonly electronProtocol: string;
  readonly secret: string;
  readonly trustedOrigins: ReadonlyArray<string>;
  readonly waitUntil?: (promise: Promise<unknown>) => void;
}

export const makeAuth = (config: AuthConfig) => {
  const security = resolveAuthSecurity(config);
  const audit = async (event: AuthAuditEvent) => {
    if (!config.audit) return;
    const task = Promise.resolve().then(async () => {
      await config.audit?.(event);
    });
    if (config.waitUntil) {
      config.waitUntil(task);
      return;
    }
    await task;
  };

  return betterAuth({
    appName: "Tabaaq",
    baseURL: security.baseURL,
    secret: config.secret,
    database: config.database,
    emailAndPassword: { enabled: true },
    trustedOrigins: [...security.trustedOrigins],
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 60,
    },
    verification: { storeInDatabase: true },
    account: {
      encryptOAuthTokens: true,
      storeStateStrategy: "cookie",
    },
    advanced: {
      useSecureCookies: security.secureCookies,
      disableCSRFCheck: false,
      disableOriginCheck: false,
      trustedProxyHeaders: false,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      },
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip"],
        disableIpTracking: false,
        ipv6Subnet: 64,
      },
      ...(config.waitUntil ? { backgroundTasks: { handler: config.waitUntil } } : {}),
    },
    databaseHooks: {
      user: {
        create: {
          after: (user) => audit({ event: "auth.user.created", userId: user.id }),
        },
      },
      session: {
        create: {
          after: (session) =>
            audit({
              event: "auth.session.created",
              userId: session.userId,
              sessionId: session.id,
              ipAddress: session.ipAddress,
              userAgent: session.userAgent,
            }),
        },
        delete: {
          after: (session) =>
            audit({
              event: "auth.session.revoked",
              userId: session.userId,
              sessionId: session.id,
              ipAddress: session.ipAddress,
              userAgent: session.userAgent,
            }),
        },
      },
      account: {
        create: {
          after: (account) =>
            audit({
              event: "auth.account.linked",
              userId: account.userId,
              providerId: account.providerId,
            }),
        },
      },
    },
    plugins: [
      organization({
        creatorRole: "owner",
        membershipLimit: 100,
      }),
      electron({ clientID: "store-electron" }),
      // Lets the Android client authenticate with `Authorization: Bearer <token>`
      // instead of a cookie jar. Converts the token back into a session cookie
      // internally before requireOrganization's getSession call, and mirrors
      // the token into a `set-auth-token` response header on sign-in.
      bearer(),
    ],
  });
};

export type StoreAuth = ReturnType<typeof makeAuth>;
export type AuthSession = StoreAuth["$Infer"]["Session"];
