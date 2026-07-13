import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { type AppEnv, requireOrganization } from "./auth-client";
import { factory } from "./factory";
import { syncRoute } from "./routes/sync";

export const createApp = (runtime: MiddlewareHandler<AppEnv>) => {
  const app = factory.createApp();
  const api = factory.createApp();

  app.use("*", runtime);
  api.use(
    "*",
    cors({
      origin: (origin, c) => (c.var.trustedOrigins.includes(origin) ? origin : ""),
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      exposeHeaders: ["Content-Length"],
      maxAge: 600,
      credentials: true,
    }),
  );

  app.get("/", (c) =>
    c.json({
      service: "Store Invoice API",
      endpoints: ["/api/health", "/api/auth/*", "/api/sync/*"],
    }),
  );
  api.get("/", (c) => c.json({ service: "Store Invoice API", ok: true }));
  api.get("/health", (c) => c.json({ ok: true }));
  api.on(["GET", "POST"], "/auth/*", (c) => c.var.authHandler(c.req.raw));

  api.use("/sync", requireOrganization);
  api.use("/sync/*", requireOrganization);
  api.route("/sync", syncRoute);
  app.route("/api", api);

  return app;
};
