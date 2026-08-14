import { electron } from "@better-auth/electron";
import { expo } from "@better-auth/expo";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { bearer, organization } from "better-auth/plugins";

import { resolveAuthSecurity, resolveTrustedOrigins } from "./security";

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
  readonly mobileProtocol: string;
  readonly secret: string;
  readonly trustedOrigins: ReadonlyArray<string>;
  readonly waitUntil?: (promise: Promise<unknown>) => void;
}

export interface EffectAuthConfig {
  readonly audit?: (event: AuthAuditEvent) => void | Promise<void>;
  readonly baseURL: string;
  readonly electronProtocol: string;
  readonly mobileProtocol: string;
  readonly secret: string;
  readonly trustedOrigins: ReadonlyArray<string>;
}

const makeAuthOptions = (
  config: Pick<AuthConfig, "audit">,
  security: ReturnType<typeof resolveAuthSecurity>,
  waitUntil?: (promise: Promise<unknown>) => void,
) => {
  const audit = async (event: AuthAuditEvent) => {
    if (!config.audit) return;
    const task = Promise.resolve().then(async () => {
      await config.audit?.(event);
    });
    if (waitUntil) {
      waitUntil(task);
      return;
    }
    await task;
  };

  return {
    appName: "Tabaaq",
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
      ...(waitUntil ? { backgroundTasks: { handler: waitUntil } } : {}),
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
      expo(),
      // Lets the Android client authenticate with `Authorization: Bearer <token>`
      // instead of a cookie jar. Converts the token back into a session cookie
      // internally before the organization middleware's getSession call, and mirrors
      // the token into a `set-auth-token` response header on sign-in.
      bearer(),
    ],
  } satisfies BetterAuthOptions;
};

const requestOrigin = (request: Request) => {
  try {
    const origin = new URL(request.url).origin;
    return origin === "null" ? undefined : origin;
  } catch {
    return undefined;
  }
};

export const makeEffectAuthConfig = (config: EffectAuthConfig) => {
  const validated = resolveAuthSecurity(config);
  const trustedOrigins = validated.trustedOrigins;

  return {
    options: {
      ...makeAuthOptions(config, validated),
      // Better Auth's router does `new URL(ctx.baseURL)` at construction. An
      // empty or placeholder value throws TypeError: Invalid URL string on
      // Cloudflare Workers and takes down every /api/auth/* request.
      baseURL: validated.baseURL,
      // Better Auth awaits this for every request while it builds the request
      // context, so anything it throws is a 500 on every auth route. Resolve
      // the extra origin through the same classifier and add nothing when the
      // request has none to offer.
      trustedOrigins: (request?: Request) => {
        const origin = request ? requestOrigin(request) : undefined;
        if (origin === undefined) return [...trustedOrigins];
        // Preview stages serve from a generated workers.dev URL the deployment
        // cannot know at build time, so the request's own origin is trusted
        // when it clears the same bar as a configured one.
        const { accepted } = resolveTrustedOrigins([origin], {
          allowInsecure: !validated.secureCookies,
        });
        return [...new Set([...trustedOrigins, ...accepted])];
      },
    },
    rejectedSettings: validated.rejectedSettings,
    trustedOrigins,
  };
};

export const makeAuth = (config: AuthConfig) => {
  const { options } = makeEffectAuthConfig(config);
  return betterAuth({
    ...options,
    secret: config.secret,
    database: config.database,
    advanced: {
      ...options.advanced,
      ...(config.waitUntil ? { backgroundTasks: { handler: config.waitUntil } } : {}),
    },
  });
};

export type StoreAuth = ReturnType<typeof makeAuth>;
export type AuthSession = StoreAuth["$Infer"]["Session"];

export { resolveAuthSecurity } from "./security";
