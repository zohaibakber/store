import { makeAuth } from "@store/auth";

import { withElectronOrigin } from "../auth/electron-origin";
import { factory } from "../http/factory";
import type { SyncActor } from "../sync/model";

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

export const workerRuntime = factory.createMiddleware(async (c, next) => {
  try {
    const trustedOrigins = commaSeparated(c.env.AUTH_TRUSTED_ORIGINS);
    const auth = makeAuth({
      baseURL: new URL(c.req.url).origin,
      database: c.env.AUTH_DB,
      electronProtocol: c.env.ELECTRON_PROTOCOL,
      secret: c.env.BETTER_AUTH_SECRET,
      trustedOrigins,
    });
    c.set("authApi", auth.api);
    c.set("authHandler", (request) =>
      auth.handler(withElectronOrigin(request, c.env.ELECTRON_PROTOCOL)),
    );
    // Sync runs inside the organization's Durable Object, which owns that
    // organization's SQLite database. Sharding on organizationId means one
    // shop's sync never serializes behind another's.
    c.set("runSync", (actor: SyncActor, request) => {
      const id = c.env.ORGANIZATION_STORE.idFromName(actor.organizationId);
      return c.env.ORGANIZATION_STORE.get(id).exchange(actor, request);
    });
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
