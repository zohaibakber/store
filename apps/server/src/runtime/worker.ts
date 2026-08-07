import { makeAuth, type AuthAuditEvent } from "@store/auth";

import { normalizeElectronOrigin } from "../auth/electron-origin";
import { kvRateLimitStorage } from "../auth/kv-rate-limit-storage";
import { factory } from "../http/factory";
import type { SyncActor } from "../sync/model";
import {
  connectWithOrganizationStore,
  exchangeWithOrganizationStore,
} from "../sync/organization-store";

const commaSeparated = (value: string): ReadonlyArray<string> =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const reportError = (event: string, cause: unknown) => {
  console.error(
    JSON.stringify({
      event,
      message: cause instanceof Error ? cause.message : String(cause),
      stack: cause instanceof Error ? cause.stack : undefined,
    }),
  );
};

const authEventMessages: Record<AuthAuditEvent["event"], string> = {
  "auth.account.linked": "Authentication account linked.",
  "auth.session.created": "Authentication session created.",
  "auth.session.revoked": "Authentication session revoked.",
  "auth.user.created": "Authentication user created.",
};

const reportAuthEvent = (event: AuthAuditEvent) => {
  console.info(JSON.stringify({ ...event, message: authEventMessages[event.event] }));
};

export const workerRuntime = factory.createMiddleware(async (c, next) => {
  try {
    const trustedOrigins = commaSeparated(c.env.AUTH_TRUSTED_ORIGINS);
    const auth = makeAuth({
      baseURL: new URL(c.req.url).origin,
      database: c.env.AUTH_DB,
      electronProtocol: c.env.ELECTRON_PROTOCOL,
      rateLimitStorage: kvRateLimitStorage(c.env.AUTH_KV),
      secret: c.env.BETTER_AUTH_SECRET,
      trustedOrigins,
      waitUntil: (promise) => c.executionCtx.waitUntil(promise),
      audit: reportAuthEvent,
    });
    c.set("authApi", auth.api);
    c.set("authHandler", (request) =>
      auth.handler(normalizeElectronOrigin(request, c.env.ELECTRON_PROTOCOL)),
    );
    c.set("runSync", (actor: SyncActor, request) =>
      exchangeWithOrganizationStore(c.env.ORGANIZATION_STORE, actor, request),
    );
    c.set("connectSyncLive", (input) =>
      connectWithOrganizationStore(c.env.ORGANIZATION_STORE, input),
    );
    c.set("trustedOrigins", trustedOrigins);
    await next();
  } catch (cause) {
    reportError("worker.request_failed", cause);
    throw cause;
  }
});

export const workerErrorHandler = (cause: Error) => {
  reportError("worker.request_failed", cause);
  return Response.json(
    { error: { code: "INTERNAL_SERVER_ERROR", message: "The request could not be handled." } },
    { status: 500 },
  );
};
