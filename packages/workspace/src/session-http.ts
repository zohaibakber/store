import type { TokenSet } from "@store/auth";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { JsonApiResponse, JsonRequestInit, JsonRequestPayload } from "./workspace";

const ACCESS_TOKEN_REFRESH_SKEW_MS = 30_000;

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

export interface TokenStore {
  get(): TokenSet | null;
  set(tokens: TokenSet | null): void;
}

export type SessionFetch = typeof fetch;

export interface SessionHttpClientOptions {
  readonly apiBaseUrl: string;
  readonly authBaseUrl: string;
  readonly tokens: TokenStore;
  readonly fetch: SessionFetch;
  readonly refreshSession: () => Promise<TokenSet | null>;
  readonly needsRefresh: (tokens: TokenSet | null, force: boolean) => boolean;
  readonly afterRefresh?: (tokens: TokenSet) => Promise<void>;
  readonly requestHeaders?: () => HeadersInit;
}

export const normalizeApiBaseUrl = (baseUrl: string) =>
  baseUrl.replace(/\/api\/?$/, "").replace(/\/$/, "");

export const normalizeAuthBaseUrl = (baseUrl: string) => baseUrl.replace(/\/$/, "");

export const isAccessTokenFresh = (
  tokens: TokenSet | null | undefined,
  skewMs = ACCESS_TOKEN_REFRESH_SKEW_MS,
  now = Date.now(),
) => tokens != null && tokens.accessExpiresAt > now + skewMs;

export const cookieSessionNeedsRefresh = (tokens: TokenSet | null, force: boolean) =>
  force || !isAccessTokenFresh(tokens);

export const refreshTokenNeedsRefresh = (tokens: TokenSet | null, force = false) =>
  !!tokens?.refreshToken && (force || !isAccessTokenFresh(tokens));

export interface SerializedRequestBody {
  readonly body: BodyInit | null | undefined;
  readonly setJsonContentType: boolean;
}

const encodeJsonBody = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

export const serializeRequestBody = (
  requestBody: JsonRequestPayload | undefined,
): SerializedRequestBody => {
  if (requestBody === undefined || requestBody === null || requestBody instanceof FormData) {
    return { body: requestBody, setJsonContentType: false };
  }
  if (Schema.is(Schema.String)(requestBody)) {
    return { body: requestBody, setJsonContentType: false };
  }
  return { body: encodeJsonBody(requestBody), setJsonContentType: true };
};

export const requestErrorFromPayload = (
  payload: JsonApiResponse | null,
  status: number,
): RequestError => {
  const failure = Schema.decodeUnknownOption(RequestFailure)(payload).pipe(Option.getOrNull);
  const nested = failure?.error;
  const message =
    failure?.message ??
    (Schema.is(Schema.String)(nested) ? nested : nested?.message) ??
    `Request failed (${status})`;
  const code = nested !== undefined && !Schema.is(Schema.String)(nested) ? nested.code : undefined;
  if (code !== undefined) return new RequestError({ message, status, code });
  return new RequestError({ message, status });
};

export class MemoryTokenStore implements TokenStore {
  #tokens: TokenSet | null = null;

  get() {
    return this.#tokens;
  }

  set(tokens: TokenSet | null) {
    this.#tokens = tokens;
  }
}

export class SessionHttpClient {
  readonly #apiBaseUrl: string;
  readonly #authBaseUrl: string;
  readonly #tokens: TokenStore;
  readonly #fetch: SessionFetch;
  readonly #refreshSession: () => Promise<TokenSet | null>;
  readonly #needsRefresh: (tokens: TokenSet | null, force: boolean) => boolean;
  readonly #afterRefresh: ((tokens: TokenSet) => Promise<void>) | undefined;
  readonly #requestHeaders: (() => HeadersInit) | undefined;
  #refreshInFlight: Promise<TokenSet | null> | null = null;

  constructor(options: SessionHttpClientOptions) {
    this.#apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
    this.#authBaseUrl = normalizeAuthBaseUrl(options.authBaseUrl);
    this.#tokens = options.tokens;
    this.#fetch = options.fetch;
    this.#refreshSession = options.refreshSession;
    this.#needsRefresh = options.needsRefresh;
    this.#afterRefresh = options.afterRefresh;
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

  ensureFreshAccess(force = false): Promise<TokenSet | null> {
    const tokens = this.#tokens.get();
    if (!this.#needsRefresh(tokens, force)) return Promise.resolve(tokens);
    if (this.#refreshInFlight) return this.#refreshInFlight;
    const release = () => {
      if (this.#refreshInFlight === refresh) this.#refreshInFlight = null;
    };
    const refresh: Promise<TokenSet | null> = this.#refreshSession()
      .then(async (next) => {
        release();
        if (next && this.#afterRefresh) await this.#afterRefresh(next);
        return next;
      })
      .finally(release);
    this.#refreshInFlight = refresh;
    return refresh;
  }

  awaitRefreshInFlight(): Promise<TokenSet | null> | null {
    return this.#refreshInFlight;
  }

  apiRequest(pathname: string, init?: JsonRequestInit): Promise<JsonApiResponse> {
    return this.request(this.#apiBaseUrl, pathname, init);
  }

  async apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    await this.ensureFreshAccess();
    const request = this.#apiRequest(input, init);
    let response = await this.#sendRaw(request.clone());
    if (response.status === 401) {
      const refreshed = await this.ensureFreshAccess(true);
      if (refreshed) response = await this.#sendRaw(request.clone());
    }
    return response;
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
    let response = await this.#send(baseUrl, pathname, init);
    if (response.status === 401) {
      const refreshed = await this.ensureFreshAccess(true);
      if (refreshed) response = await this.#send(baseUrl, pathname, init);
    }

    const bodyText = await response.text().catch(() => "");
    const parsed =
      bodyText.trim().length === 0
        ? Option.none<typeof Schema.Json.Type>()
        : Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json))(bodyText);
    if (!response.ok) {
      throw requestErrorFromPayload(Option.getOrNull(parsed), response.status);
    }
    if (Option.isNone(parsed)) {
      throw new RequestError({
        message: "The server returned an invalid JSON response.",
        status: response.status,
        code: "INVALID_JSON_RESPONSE",
      });
    }
    return parsed.value;
  }

  async #send(baseUrl: string, pathname: string, init?: JsonRequestInit): Promise<Response> {
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
    return this.#fetch(`${baseUrl}${pathname}`, {
      ...init,
      body,
      credentials: "omit",
      headers,
    });
  }

  #apiRequest(input: RequestInfo | URL, init?: RequestInit): Request {
    const request =
      input instanceof Request
        ? new Request(input, init)
        : new Request(new URL(input.toString(), `${this.#apiBaseUrl}/`), init);
    const apiOrigin = new URL(`${this.#apiBaseUrl}/`).origin;
    if (new URL(request.url).origin !== apiOrigin) {
      throw new TypeError("Authenticated API requests must use the configured API origin.");
    }
    return request;
  }

  #sendRaw(request: Request): Promise<Response> {
    const headers = new Headers(request.headers);
    const extra = this.#requestHeaders?.();
    if (extra) {
      new Headers(extra).forEach((value, key) => headers.set(key, value));
    }
    const tokens = this.#tokens.get();
    if (tokens) headers.set("authorization", `Bearer ${tokens.accessToken}`);
    return this.#fetch(new Request(request, { credentials: "omit", headers }));
  }
}
