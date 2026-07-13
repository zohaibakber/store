import type { AuthSession } from "@store/auth";
import type { MiddlewareHandler } from "hono";
import { publicError } from "./errors";
import type { SyncRunner } from "./routes/sync";

export type AuthApi = {
  getSession(options: { headers: Headers }): Promise<AuthSession | null>;
  getActiveMember(options: { headers: Headers }): Promise<object | null>;
};

export type AppEnv = {
  Bindings: CloudflareBindings;
  Variables: {
    authApi: AuthApi;
    authHandler: (request: Request) => Promise<Response>;
    runSync: SyncRunner;
    trustedOrigins: ReadonlyArray<string>;
    user: AuthSession["user"];
    session: AuthSession["session"];
    organizationId: string;
  };
};

export const requireOrganization: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await c.var.authApi.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json(publicError("UNAUTHENTICATED", "Authentication is required."), 401);
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId)
    return c.json(publicError("ORGANIZATION_REQUIRED", "Select an organization first."), 403);
  const member = await c.var.authApi.getActiveMember({ headers: c.req.raw.headers });
  if (!member)
    return c.json(publicError("ORGANIZATION_ACCESS_DENIED", "Organization access is denied."), 403);
  c.set("user", session.user);
  c.set("session", session.session);
  c.set("organizationId", organizationId);
  await next();
};
