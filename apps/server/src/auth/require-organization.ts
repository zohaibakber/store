import type { MiddlewareHandler } from "hono";

import type { AppEnv } from "../http/context";
import { publicError } from "../http/errors";

export const authHeadersForRequest = (requestHeaders: Headers) => {
  if (requestHeaders.has("origin")) return requestHeaders;

  const expoOrigin = requestHeaders.get("expo-origin");
  if (!expoOrigin) return requestHeaders;

  // Native fetch does not allow React Native to set the browser Origin header.
  // Mirror the header used by @better-auth/expo; Better Auth still validates
  // this value against its configured trusted origins.
  const authHeaders = new Headers(requestHeaders);
  authHeaders.set("origin", expoOrigin);
  return authHeaders;
};

export const requireOrganization: MiddlewareHandler<AppEnv> = async (c, next) => {
  const headers = authHeadersForRequest(c.req.raw.headers);
  const session = await c.var.authApi.getSession({ headers });
  if (!session) return c.json(publicError("UNAUTHENTICATED", "Authentication is required."), 401);
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId)
    return c.json(publicError("ORGANIZATION_REQUIRED", "Select an organization first."), 403);
  const member = await c.var.authApi.getActiveMember({ headers });
  if (!member)
    return c.json(publicError("ORGANIZATION_ACCESS_DENIED", "Organization access is denied."), 403);
  c.set("user", session.user);
  c.set("session", session.session);
  c.set("organizationId", organizationId);
  await next();
};
