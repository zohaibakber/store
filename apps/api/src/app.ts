import { Hono } from "hono";
import { cors } from "hono/cors";
import { type AppEnv, type AuthApi, requireOrganization } from "./auth-client";
import { modelsRoute } from "./routes/models";
import { syncRoute, type SyncRunner } from "./routes/sync";
import { uploadsRoute } from "./routes/uploads";

export interface AppDependencies {
  readonly authApi: AuthApi;
  readonly authHandler: (request: Request) => Promise<Response>;
  readonly runSync: SyncRunner;
  readonly trustedOrigins: ReadonlyArray<string>;
}

export const createApp = (dependencies: AppDependencies) => {
  const app = new Hono<AppEnv>();
  const api = app.basePath("/api");
  const corsOrigins = dependencies.trustedOrigins.filter((origin) => origin.startsWith("http"));

  app.use(
    "/api/*",
    cors({
      origin: corsOrigins,
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      exposeHeaders: ["Content-Length", "set-auth-token"],
      maxAge: 600,
      credentials: true,
    }),
  );

  app.get("/", (c) =>
    c.json({
      service: "Store Invoice API",
      endpoints: ["/api/health", "/api/auth/*", "/api/models", "/api/uploads", "/api/sync/*"],
    }),
  );
  api.get("/", (c) => c.json({ service: "Store Invoice API", ok: true }));
  api.get("/health", (c) => c.json({ ok: true }));
  app.on(["GET", "POST"], "/api/auth/*", (c) => dependencies.authHandler(c.req.raw));

  const authorized = requireOrganization(dependencies.authApi);
  api.use("/models", authorized);
  api.use("/uploads", authorized);
  api.use("/sync", authorized);
  api.use("/sync/*", authorized);

  api.route("/models", modelsRoute);
  api.route("/uploads", uploadsRoute);
  api.route("/sync", syncRoute(dependencies.runSync));

  return app;
};
