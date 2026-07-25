import { electron } from "@better-auth/electron";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";

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

export interface AuthRateLimitRecord {
  readonly count: number;
  readonly key: string;
  readonly lastRequest: number;
}

export interface AuthRateLimitStorage {
  readonly get: (key: string) => Promise<AuthRateLimitRecord | null | undefined>;
  readonly set: (key: string, value: AuthRateLimitRecord, update?: boolean) => Promise<void>;
}

export interface AuthConfig {
  readonly audit?: (event: AuthAuditEvent) => void | Promise<void>;
  readonly baseURL: string;
  readonly database: D1Database;
  readonly electronProtocol: string;
  readonly rateLimitStorage: AuthRateLimitStorage;
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
    rateLimit: {
      enabled: true,
      customStorage: config.rateLimitStorage,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 3 },
        "/change-password": { window: 60, max: 3 },
        "/change-email": { window: 60, max: 3 },
      },
    },
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
    ],
  });
};

export type StoreAuth = ReturnType<typeof makeAuth>;
export type AuthSession = StoreAuth["$Infer"]["Session"];
