import { makeAuth } from "@store/auth";
import { createAuthDatabase } from "@store/db/auth.database";
import { withElectronOrigin } from "../auth/electron-origin";
import { factory } from "../http/factory";
import { makeSyncRuntime } from "../sync/runtime";

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
  const authDatabase = createAuthDatabase(c.env.HYPERDRIVE.connectionString);
  const syncRuntime = makeSyncRuntime(c.env.HYPERDRIVE.connectionString);
  const dispose = async () => {
    const results = await Promise.allSettled([authDatabase.destroy(), syncRuntime.dispose()]);
    for (const result of results)
      if (result.status === "rejected")
        reportError("worker.resource_dispose_failed", result.reason);
  };

  try {
    const trustedOrigins = commaSeparated(c.env.AUTH_TRUSTED_ORIGINS);
    const auth = makeAuth({
      baseURL: new URL(c.req.url).origin,
      database: authDatabase,
      electronProtocol: c.env.ELECTRON_PROTOCOL,
      secret: c.env.BETTER_AUTH_SECRET,
      trustedOrigins,
    });
    c.set("authApi", auth.api);
    c.set("authHandler", (request) =>
      auth.handler(withElectronOrigin(request, c.env.ELECTRON_PROTOCOL)),
    );
    c.set("runSync", syncRuntime.runSync);
    c.set("trustedOrigins", trustedOrigins);
    await next();
  } finally {
    c.executionCtx.waitUntil(dispose());
  }
});

export const workerErrorHandler = (cause: Error) => {
  reportError("worker.request_failed", cause);
  return Response.json(
    { error: { code: "INTERNAL_SERVER_ERROR", message: "The request could not be handled." } },
    { status: 500 },
  );
};
