import { makeAuth } from "@store/auth";

import { normalizeElectronOrigin } from "../auth/electron-origin";
import { kvSecondaryStorage } from "../auth/kv-secondary-storage";
import { factory } from "../http/factory";
import type { SyncActor } from "../sync/model";
import { exchangeWithOrganizationStore } from "../sync/organization-store";

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

const reportAuthEvent = (event: object) => {
  console.info(JSON.stringify(event));
};

export const workerRuntime = factory.createMiddleware(async (c, next) => {
  try {
    const trustedOrigins = commaSeparated(c.env.AUTH_TRUSTED_ORIGINS);
    const auth = makeAuth({
      baseURL: new URL(c.req.url).origin,
      database: c.env.AUTH_DB,
      electronProtocol: c.env.ELECTRON_PROTOCOL,
      secondaryStorage: kvSecondaryStorage(c.env.AUTH_KV),
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
