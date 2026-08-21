import { TokenSet, type TokenSet as TokenSetType } from "@store/auth";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { JsonApiResponse, JsonRequestInit } from "./workspace";

/** Refresh when the access token is within this many ms of expiry. */
export const ACCESS_TOKEN_REFRESH_SKEW_MS = 30_000;

const RequestFailure = Schema.Struct({
  message: Schema.optional(Schema.String),
  error: Schema.optional(
    Schema.Union([
      Schema.String,
      Schema.Struct({
        code: Schema.optional(Schema.String),
        message: Schema.optional(Schema.String),
      }),
    ]),
  ),
});

export class RequestError extends Schema.TaggedError<RequestError>()("Workspace.RequestError", {
  message: Schema.String,
  status: Schema.Number,
  code: Schema.optionalKey(Schema.String),
}) {}

/** Where access/refresh tokens live for a host (memory, cookie session, safeStorage). */
export interface TokenStore {
  get(): TokenSetType | null;
  set(tokens: TokenSetType | null): void;
}

export type SessionFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface SessionHttpClientOptions {
  readonly apiBaseUrl: string;
  readonly authBaseUrl: string;
  readonly tokens: TokenStore;
  readonly fetch: SessionFetch;
  /**
   * Platform refresh (cookie credentials vs refresh-token body). Must update
   * `tokens` on success and return `null` on expected refresh failure (do not
   * throw for HTTP 401/403/non-OK — callers share one failure model). Concurrent
   * callers share one in-flight refresh.
   */
  readonly refreshSession: () => Promise<TokenSetType | null>;
  /** Decide whether `refreshSession` should run for the current tokens. */
  readonly needsRefresh: (tokens: TokenSetType | null, force: boolean) => boolean;
  /** Extra headers on every bearer request (e.g. Electron `electron-origin`). */
  readonly requestHeaders?: () => HeadersInit;
}

export const normalizeApiBaseUrl = (baseUrl: string) =>
  baseUrl.replace(/\/api\/?$/, "").replace(/\/$/, "");

export const normalizeAuthBaseUrl = (baseUrl: string) => baseUrl.replace(/\/$/, "");

export const isAccessTokenFresh = (
  tokens: TokenSetType | null | undefined,
  skewMs = ACCESS_TOKEN_REFRESH_SKEW_MS,
  now = Date.now(),
) => tokens != null && tokens.accessExpiresAt > now + skewMs;

/** Cookie-session hosts: refresh when forced, missing, or near expiry. */
export const cookieSessionNeedsRefresh = (tokens: TokenSetType | null, force: boolean) =>
  force || !isAccessTokenFresh(tokens);

/**
 * Refresh-token hosts: rotate when a refresh token exists and access is stale,
 * or when `force` is set (e.g. renew after org rename / invite redeem).
 */
export const refreshTokenNeedsRefresh = (tokens: TokenSetType | null, force = false) =>
  !!tokens?.refreshToken && (force || !isAccessTokenFresh(tokens));

export const serializeRequestBody = (
  requestBody: unknown,
): {
  readonly body: BodyInit | null | undefined;
  readonly setJsonContentType: boolean;
} => {
  if (requestBody === undefined || requestBody === null || requestBody instanceof FormData) {
    return { body: requestBody as BodyInit | null | undefined, setJsonContentType: false };
  }
  if (Schema.is(Schema.String)(requestBody)) {
    return { body: requestBody, setJsonContentType: false };
  }
  return { body: JSON.stringify(requestBody), setJsonContentType: true };
};

export const requestErrorFromPayload = (payload: unknown, status: number): RequestError => {
  const failure = Schema.decodeUnknownOption(RequestFailure)(payload).pipe(Option.getOrNull);
  const nested = failure?.error;
  const message =
    failure?.message ??
    (Schema.is(Schema.String)(nested) ? nested : nested?.message) ??
    `Request failed (${status})`;
  const code =
    nested !== undefined && !Schema.is(Schema.String)(nested) ? nested.code : undefined;
  if (code !== undefined) return new RequestError({ message, status, code });
  return new RequestError({ message, status });
};

export class MemoryTokenStore implements TokenStore {
  #tokens: TokenSetType | null = null;

  get() {
    return this.#tokens;
  }

  set(tokens: TokenSetType | null) {
    this.#tokens = tokens;
  }
}

/**
 * Authenticated JSON HTTP against the store API and auth service. Hosts supply
 * fetch, token storage, and refresh; this module owns bearer injection, body
 * serialization, failure parsing, and refresh coalescing.
 */
export class SessionHttpClient {
  readonly #apiBaseUrl: string;
  readonly #authBaseUrl: string;
  readonly #tokens: TokenStore;
  readonly #fetch: SessionFetch;
  readonly #refreshSession: () => Promise<TokenSetType | null>;
  readonly #needsRefresh: (tokens: TokenSetType | null, force: boolean) => boolean;
  readonly #requestHeaders: (() => HeadersInit) | undefined;
  #refreshInFlight: Promise<TokenSetType | null> | null = null;

  constructor(options: SessionHttpClientOptions) {
    this.#apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
    this.#authBaseUrl = normalizeAuthBaseUrl(options.authBaseUrl);
    this.#tokens = options.tokens;
    this.#fetch = options.fetch;
    this.#refreshSession = options.refreshSession;
    this.#needsRefresh = options.needsRefresh;
    this.#requestHeaders = options.requestHeaders;
  }

  get apiBaseUrl() {
    return this.#apiBaseUrl;
  }

  get authBaseUrl() {
    return this.#authBaseUrl;
  }

  get tokens() {
    return this.#tokens;
  }

  ensureFreshAccess(force = false): Promise<TokenSetType | null> {
    const tokens = this.#tokens.get();
    if (!this.#needsRefresh(tokens, force)) return Promise.resolve(tokens);
    if (this.#refreshInFlight) return this.#refreshInFlight;
    this.#refreshInFlight = this.#refreshSession().finally(() => {
      this.#refreshInFlight = null;
    });
    return this.#refreshInFlight;
  }

  /** Wait for an in-flight refresh without starting a new one (e.g. before sign-out). */
  awaitRefreshInFlight(): Promise<TokenSetType | null> | null {
    return this.#refreshInFlight;
  }

  apiRequest(pathname: string, init?: JsonRequestInit): Promise<JsonApiResponse> {
    return this.request(this.#apiBaseUrl, pathname, init);
  }

  authRequest(pathname: string, init?: JsonRequestInit): Promise<JsonApiResponse> {
    return this.request(this.#authBaseUrl, pathname, init);
  }

  async request(
    baseUrl: string,
    pathname: string,
    init?: JsonRequestInit,
  ): Promise<JsonApiResponse> {
    await this.ensureFreshAccess();
    const headers = new Headers(init?.headers);
    const extra = this.#requestHeaders?.();
    if (extra) {
      new Headers(extra).forEach((value, key) => {
        headers.set(key, value);
      });
    }
    const tokens = this.#tokens.get();
    if (tokens) headers.set("authorization", `Bearer ${tokens.accessToken}`);
    const { body, setJsonContentType } = serializeRequestBody(init?.body);
    if (setJsonContentType) headers.set("content-type", "application/json");
    const response = await this.#fetch(`${baseUrl}${pathname}`, {
      ...init,
      body,
      credentials: "omit",
      headers,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw requestErrorFromPayload(payload, response.status);
    return payload as JsonApiResponse;
  }
}

export const decodeTokenSet = (payload: unknown): TokenSetType =>
  Schema.decodeUnknownSync(TokenSet)(payload);
