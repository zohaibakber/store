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

/**
 * Effect HTTP's `toWeb` uses `source instanceof Request`. Across workerd
 * realms that check fails and it rebuilds from a path-only `url`, which
 * throws `TypeError: Invalid URL string.` Hono passed `c.req.raw` instead.
 * Prefer the original Cloudflare Request (Alchemy puts it on `source`).
 */
export const isWebRequest = (value: unknown): value is Request =>
  typeof value === "object" &&
  value !== null &&
  "url" in value &&
  "method" in value &&
  "headers" in value &&
  typeof (value as Request).url === "string" &&
  typeof (value as Request).method === "string";

export const webRequestForAuth = (
  request: { readonly url: string; readonly originalUrl?: string; readonly source: unknown },
  raw: unknown,
  baseURL: string,
): Request => {
  if (isWebRequest(raw)) return absoluteAuthRequest(raw, baseURL);
  if (isWebRequest(request.source)) return absoluteAuthRequest(request.source, baseURL);
  const relative = request.originalUrl && request.originalUrl.length > 0 ? request.originalUrl : request.url;
  return new Request(new URL(relative, baseURL));
};
