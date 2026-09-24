import type { TokenSet } from "@store/auth";
import type { SessionHttpClient } from "@store/workspace";

export interface AuthenticatedFetchOptions {
  readonly http: SessionHttpClient;
  readonly fetch: typeof fetch;
}

const originOf = (baseUrl: string) => new URL(`${baseUrl}/`).origin;

const urlOf = (input: RequestInfo | URL, apiBaseUrl: string) => {
  const raw = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
  return new URL(raw, `${apiBaseUrl}/`);
};

const currentOrNull = (http: SessionHttpClient) => http.tokens.get();

export const makeAuthenticatedFetch = ({
  http,
  fetch: send,
}: AuthenticatedFetchOptions): typeof fetch => {
  const trustedOrigins = new Set([originOf(http.apiBaseUrl), originOf(http.authBaseUrl)]);

  const attempt = (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    url: URL,
    tokens: TokenSet | null,
  ) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    if (tokens) headers.set("authorization", `Bearer ${tokens.accessToken}`);
    const target = input instanceof Request ? input.clone() : url.href;
    return send(target, { ...init, headers, credentials: "omit" });
  };

  return async (input, init) => {
    const url = urlOf(input, http.apiBaseUrl);
    if (!trustedOrigins.has(url.origin)) {
      throw new TypeError("Authenticated requests must go to the Tabaaq API.");
    }
    const sent = await http.ensureFreshAccess().catch(() => currentOrNull(http));
    const response = await attempt(input, init, url, sent);
    if (response.status !== 401 || sent === null) return response;

    const latest = currentOrNull(http);
    const next =
      latest !== null && latest.accessToken !== sent.accessToken
        ? latest
        : await http.ensureFreshAccess(true).catch(() => null);
    if (next === null || next.accessToken === sent.accessToken) return response;
    return attempt(input, init, url, next);
  };
};
