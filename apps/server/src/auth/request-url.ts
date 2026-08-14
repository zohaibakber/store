/**
 * Better Auth does `new URL(request.url)` while building the request context.
 * Effect HTTP stores paths without a scheme/host, and a Worker behind a service
 * binding can hand over the same shape. `new URL("/api/auth/ok")` throws
 * `TypeError: Invalid URL string.` on workerd and 500s every auth route.
 *
 * Hono never hit this: it passed `c.req.raw`, whose URL is the Cloudflare
 * request URL. Rebuild against the configured public origin unless the incoming
 * URL is already an absolute http(s) URL.
 */
export const isAbsoluteHttpUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

export const absoluteAuthRequest = (request: Request, baseURL: string): Request => {
  if (isAbsoluteHttpUrl(request.url)) return request;
  return new Request(new URL(request.url, baseURL), request);
};
