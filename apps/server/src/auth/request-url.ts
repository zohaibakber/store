/**
 * Better Auth does `new URL(request.url)` while building the request context.
 * A relative URL — what Cloudflare can hand a Worker behind a service binding —
 * throws `TypeError: Invalid URL string.` on workerd and 500s every auth route.
 * Rebuild against the configured public origin when the incoming URL isn't
 * already absolute.
 */
export const absoluteAuthRequest = (request: Request, baseURL: string): Request => {
  try {
    new URL(request.url);
    return request;
  } catch {
    return new Request(new URL(request.url, baseURL), request);
  }
};
