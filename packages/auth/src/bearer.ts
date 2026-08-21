export const bearerToken = (authorization: string | undefined) => {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;
  return token.trim() || null;
};

export const bearerTokenFromHeaders = (headers: Headers) =>
  bearerToken(headers.get("authorization") ?? undefined);

/** Browser WebSocket constructors cannot set Authorization; live sync uses this query. */
export const accessTokenFromUrl = (url: string) => {
  const query = url.includes("://")
    ? (() => {
        try {
          return new URL(url).searchParams.get("access_token");
        } catch {
          return null;
        }
      })()
    : new URLSearchParams(url.split("?")[1] ?? "").get("access_token");
  const token = query?.trim();
  return token || null;
};

export const headersWithAccessToken = (headers: Headers, url: string) => {
  if (bearerTokenFromHeaders(headers)) return headers;
  const token = accessTokenFromUrl(url);
  if (!token) return headers;
  const next = new Headers(headers);
  next.set("authorization", `Bearer ${token}`);
  return next;
};
