import {
  AuthHttpApi,
  TokenSet,
  authHttpErrorStatus,
  type AuthHttpError,
  type OrganizationCommand,
  type OrganizationCommandResult,
  type OrganizationRoster,
  type RefreshedSession,
  type RefreshInput,
} from "@store/auth";
import { AuthenticatedWorkspaceSnapshot, WorkspaceSnapshot } from "@store/contracts/workspace";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SynchronizedRef from "effect/SynchronizedRef";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as Headers from "effect/unstable/http/Headers";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as HttpIncomingMessage from "effect/unstable/http/HttpIncomingMessage";
import * as HttpMethod from "effect/unstable/http/HttpMethod";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

const ACCESS_TOKEN_REFRESH_SKEW_MS = 30_000;
const INVALID_RESPONSE = "INVALID_RESPONSE";
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 103, 204, 205, 304]);

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

export const RefreshedTokenSet = TokenSet.pipe(
  Schema.fieldsAssign({ workspace: AuthenticatedWorkspaceSnapshot }),
);
export interface RefreshedTokenSet extends Schema.Schema.Type<typeof RefreshedTokenSet> {}

type UnrefreshedTokenSet = TokenSet & { readonly workspace?: undefined };

export type SessionAccess = RefreshedTokenSet | UnrefreshedTokenSet | null;

export const refreshedTokens = (refreshed: TokenSet): TokenSet =>
  Struct.pick(refreshed, ["accessToken", "accessExpiresAt", "refreshToken", "refreshExpiresAt"]);

export interface TokenStore {
  get(): TokenSet | null;
  set(tokens: TokenSet | null): void;
}

export class MemoryTokenStore implements TokenStore {
  #tokens: TokenSet | null = null;

  get() {
    return this.#tokens;
  }

  set(tokens: TokenSet | null) {
    this.#tokens = tokens;
  }
}

export type RefreshPolicy = (tokens: TokenSet | null, force: boolean, now: number) => boolean;

const isAccessTokenFresh = (tokens: TokenSet | null, now: number) =>
  tokens != null && tokens.accessExpiresAt > now + ACCESS_TOKEN_REFRESH_SKEW_MS;

export const cookieSessionNeedsRefresh: RefreshPolicy = (tokens, force, now) =>
  force || !isAccessTokenFresh(tokens, now);

export const refreshTokenNeedsRefresh: RefreshPolicy = (tokens, force, now) =>
  !!tokens?.refreshToken && (force || !isAccessTokenFresh(tokens, now));

export type SessionCredential = "cookie" | "refreshToken";

interface CredentialPolicy {
  readonly needsRefresh: RefreshPolicy;
  readonly requestInit: RequestInit;
  readonly input: (tokens: TokenSet | null) => RefreshInput | undefined;
}

const credentialPolicies = {
  cookie: {
    needsRefresh: cookieSessionNeedsRefresh,
    requestInit: { credentials: "include" },
    input: () => ({}),
  },
  refreshToken: {
    needsRefresh: refreshTokenNeedsRefresh,
    requestInit: {},
    input: (tokens) =>
      tokens?.refreshToken === undefined ? undefined : { refreshToken: tokens.refreshToken },
  },
} satisfies Record<SessionCredential, CredentialPolicy>;

export const requestErrorFromPayload = (
  payload: Schema.Json | null,
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

const invalidResponse = () =>
  new RequestError({
    message: "The server returned an invalid response.",
    status: 502,
    code: INVALID_RESPONSE,
  });

export const isInvalidResponse = (error: RequestError) => error.code === INVALID_RESPONSE;

const isSuccessStatus = (status: number) => status >= 200 && status < 300;

const isRejectedStatus = (status: number) => status === 401 || status === 403;

const failedResponse = (response: HttpClientResponse.HttpClientResponse) =>
  response.json.pipe(
    Effect.option,
    Effect.map((payload) => requestErrorFromPayload(Option.getOrNull(payload), response.status)),
  );

const fromClientError = (error: HttpClientError.HttpClientError): Effect.Effect<RequestError> => {
  const response = error.response;
  if (response !== undefined) {
    return isSuccessStatus(response.status)
      ? Effect.succeed(invalidResponse())
      : failedResponse(response);
  }
  const reason = error.reason;
  const cause = "cause" in reason ? reason.cause : undefined;
  return Effect.succeed(
    new RequestError({
      message: cause instanceof Error ? cause.message : error.message,
      status: 0,
      code: reason._tag === "TransportError" ? "NETWORK_ERROR" : "INVALID_REQUEST",
    }),
  );
};

type SessionFailure =
  | RequestError
  | HttpClientError.HttpClientError
  | Schema.SchemaError
  | AuthHttpError;

export const toRequestError = (failure: SessionFailure): Effect.Effect<RequestError> => {
  if (failure instanceof RequestError) return Effect.succeed(failure);
  if (HttpClientError.isHttpClientError(failure)) return fromClientError(failure);
  if (failure instanceof Schema.SchemaError) return Effect.succeed(invalidResponse());
  return Effect.succeed(
    new RequestError({
      message: failure.error.message,
      status: authHttpErrorStatus(failure._tag),
      code: failure.error.code,
    }),
  );
};

const asRequestError = <A, R>(effect: Effect.Effect<A, SessionFailure, R>) =>
  effect.pipe(Effect.catch((failure) => Effect.flatMap(toRequestError(failure), Effect.fail)));

export const decodeResponse =
  <S extends Schema.Constraint>(schema: S) =>
  (
    response: HttpClientResponse.HttpClientResponse,
  ): Effect.Effect<S["Type"], RequestError, S["DecodingServices"]> =>
    asRequestError(
      isSuccessStatus(response.status)
        ? HttpIncomingMessage.schemaBodyJson(schema)(response)
        : Effect.flatMap(failedResponse(response), Effect.fail),
    );

const normalizeApiBaseUrl = (baseUrl: string) =>
  baseUrl.replace(/\/api\/?$/, "").replace(/\/$/, "");

const normalizeAuthBaseUrl = (baseUrl: string) => baseUrl.replace(/\/$/, "");

export interface SessionHttpOptions {
  readonly apiBaseUrl: string;
  readonly authBaseUrl: string;
  readonly tokens: TokenStore;
  readonly credential: SessionCredential;
  readonly onRefreshed: (refreshed: RefreshedTokenSet) => Effect.Effect<void>;
  readonly onRejected: Effect.Effect<void>;
}

export interface SessionHttpApi {
  readonly apiBaseUrl: string;
  readonly authBaseUrl: string;
  readonly tokens: Pick<TokenStore, "get">;
  readonly setTokens: (tokens: TokenSet | null) => Effect.Effect<void>;
  readonly ensureFreshAccess: (force?: boolean) => Effect.Effect<SessionAccess, RequestError>;
  readonly renewAccess: Effect.Effect<RefreshedTokenSet | null, RequestError>;
  readonly settled: Effect.Effect<void>;
  readonly http: HttpClient.HttpClient.With<HttpClientError.HttpClientError | RequestError>;
  readonly workspace: Effect.Effect<WorkspaceSnapshot, RequestError>;
  readonly organizationRoster: Effect.Effect<OrganizationRoster, RequestError>;
  readonly organize: (
    command: OrganizationCommand,
  ) => Effect.Effect<OrganizationCommandResult, RequestError>;
  readonly logout: (tokens: TokenSet | null) => Effect.Effect<void, RequestError>;
}

export class SessionHttp extends Context.Service<SessionHttp, SessionHttpApi>()(
  "@store/workspace/SessionHttp",
) {}

type Rotation =
  | { readonly _tag: "Skipped" }
  | { readonly _tag: "Rejected" }
  | { readonly _tag: "Refreshed"; readonly refreshed: RefreshedTokenSet };

interface Flight {
  readonly seq: number;
  readonly generation: number;
  readonly done: Deferred.Deferred<RefreshedTokenSet | null, RequestError>;
  readonly fiber: Fiber.Fiber<RefreshedTokenSet | null, RequestError>;
}

interface SessionState {
  readonly generation: number;
  readonly seq: number;
  readonly flight: Flight | undefined;
}

const skipped: Rotation = { _tag: "Skipped" };
const rejected: Rotation = { _tag: "Rejected" };

const decodeWorkspace = Schema.decodeUnknownEffect(AuthenticatedWorkspaceSnapshot);

const refreshedSession = (session: RefreshedSession) =>
  decodeWorkspace(session.workspace).pipe(
    Effect.map((workspace): Rotation => ({
      _tag: "Refreshed",
      refreshed: Struct.assign(refreshedTokens(session), { workspace }),
    })),
  );

const bearer = (tokens: TokenSet) => `Bearer ${tokens.accessToken}`;

export const makeSessionHttp = Effect.fnUntraced(function* (options: SessionHttpOptions) {
  const base = yield* HttpClient.HttpClient;
  const scope = yield* Effect.scope;
  const policy = credentialPolicies[options.credential];
  const store = options.tokens;
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  const authBaseUrl = normalizeAuthBaseUrl(options.authBaseUrl);
  const state = yield* SynchronizedRef.make<SessionState>({
    generation: 0,
    seq: 0,
    flight: undefined,
  });

  const sessionApi = yield* HttpApiClient.group(AuthHttpApi, {
    group: "session",
    httpClient: HttpClient.transformResponse(
      base,
      Effect.provideService(FetchHttpClient.RequestInit, policy.requestInit),
    ),
    baseUrl: authBaseUrl,
  });

  const rotate = Effect.suspend(() => {
    const payload = policy.input(store.get());
    if (payload === undefined) return Effect.succeed(skipped);
    return sessionApi.refresh({ payload }).pipe(
      Effect.flatMap(refreshedSession),
      Effect.catch((failure) =>
        Effect.flatMap(toRequestError(failure), (error) =>
          isRejectedStatus(error.status) ? Effect.succeed(rejected) : Effect.fail(error),
        ),
      ),
    );
  });

  const commit =
    (current: SessionState, flight: Pick<Flight, "seq" | "generation">) =>
    (rotation: Rotation): Effect.Effect<readonly [RefreshedTokenSet | null, SessionState]> => {
      if (current.flight?.seq !== flight.seq || current.generation !== flight.generation) {
        return Effect.succeed([null, current] as const);
      }
      const next: SessionState = {
        generation: current.generation + 1,
        seq: current.seq,
        flight: undefined,
      };
      switch (rotation._tag) {
        case "Skipped":
          return Effect.succeed([null, { ...current, flight: undefined }] as const);
        case "Rejected":
          return Effect.sync(() => store.set(null)).pipe(
            Effect.andThen(options.onRejected),
            Effect.as([null, next] as const),
          );
        case "Refreshed":
          return Effect.sync(() => store.set(refreshedTokens(rotation.refreshed))).pipe(
            Effect.andThen(options.onRefreshed(rotation.refreshed)),
            Effect.as([rotation.refreshed, next] as const),
          );
      }
    };

  const runFlight = (
    flight: Pick<Flight, "seq" | "generation" | "done">,
  ): Effect.Effect<RefreshedTokenSet | null, RequestError> =>
    rotate.pipe(
      Effect.flatMap((rotation) =>
        SynchronizedRef.modifyEffect(state, (current) => commit(current, flight)(rotation)),
      ),
      Effect.onExit((exit) =>
        SynchronizedRef.update(state, (current) =>
          current.flight?.seq === flight.seq ? { ...current, flight: undefined } : current,
        ).pipe(
          Effect.andThen(
            Exit.hasInterrupts(exit)
              ? Deferred.succeed(flight.done, null)
              : Deferred.done(flight.done, exit),
          ),
        ),
      ),
    );

  const startFlight = (current: SessionState) =>
    Effect.gen(function* () {
      const seq = current.seq + 1;
      const done = yield* Deferred.make<RefreshedTokenSet | null, RequestError>();
      const fiber = yield* Effect.forkIn(
        runFlight({ seq, generation: current.generation, done }),
        scope,
      );
      const flight: Flight = { seq, generation: current.generation, done, fiber };
      return [flight, { ...current, seq, flight }] as const;
    });

  const flightAfter = (after: number): Effect.Effect<Flight> =>
    SynchronizedRef.modifyEffect(state, (current) =>
      current.flight === undefined
        ? startFlight(current)
        : Effect.succeed([current.flight, current] as const),
    ).pipe(
      Effect.uninterruptible,
      Effect.flatMap((flight) =>
        flight.seq > after
          ? Effect.succeed(flight)
          : Deferred.await(flight.done).pipe(
              Effect.exit,
              Effect.andThen(Effect.suspend(() => flightAfter(after))),
            ),
      ),
    );

  const ensureFreshAccess = (force = false): Effect.Effect<SessionAccess, RequestError> =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const tokens = store.get();
      if (!policy.needsRefresh(tokens, force, now)) return tokens;
      const flight = yield* flightAfter(0);
      return yield* Deferred.await(flight.done);
    });

  const renewAccess = SynchronizedRef.get(state).pipe(
    Effect.flatMap((current) => flightAfter(current.seq)),
    Effect.flatMap((flight) => Deferred.await(flight.done)),
  );

  const settled = SynchronizedRef.get(state).pipe(
    Effect.flatMap((current) =>
      current.flight === undefined
        ? Effect.void
        : Deferred.await(current.flight.done).pipe(Effect.exit, Effect.asVoid),
    ),
  );

  const setTokens = (tokens: TokenSet | null) =>
    SynchronizedRef.modifyEffect(state, (current) =>
      Effect.sync(() => {
        store.set(tokens);
        return [
          current.flight,
          { generation: current.generation + 1, seq: current.seq, flight: undefined },
        ] as const;
      }),
    ).pipe(
      Effect.flatMap((flight) =>
        flight === undefined ? Effect.void : Fiber.interrupt(flight.fiber),
      ),
    );

  const authorize = (request: HttpClientRequest.HttpClientRequest) =>
    ensureFreshAccess().pipe(
      Effect.map(() => {
        const tokens = store.get();
        return tokens === null
          ? request
          : HttpClientRequest.bearerToken(request, tokens.accessToken);
      }),
    );

  const replayUnauthorized = (
    request: HttpClientRequest.HttpClientRequest,
    response: HttpClientResponse.HttpClientResponse,
  ) =>
    Effect.gen(function* () {
      const sent = Headers.get(request.headers, "authorization").pipe(Option.getOrUndefined);
      const current = store.get();
      const next =
        current !== null && bearer(current) !== sent ? current : yield* ensureFreshAccess(true);
      if (next === null || bearer(next) === sent) return response;
      return yield* base.execute(HttpClientRequest.bearerToken(request, next.accessToken));
    });

  const http = base.pipe(
    HttpClient.mapRequestEffect(authorize),
    HttpClient.transform((send, request) =>
      Effect.flatMap(send, (response) =>
        response.status === 401 ? replayUnauthorized(request, response) : Effect.succeed(response),
      ),
    ),
    HttpClient.transformResponse(
      Effect.provideService(FetchHttpClient.RequestInit, { credentials: "omit" }),
    ),
  );

  const organizationApi = yield* HttpApiClient.group(AuthHttpApi, {
    group: "organization",
    httpClient: http,
    baseUrl: authBaseUrl,
  });

  const organize = (command: OrganizationCommand) => {
    switch (command._tag) {
      case "UpdateOrganization":
        return asRequestError(organizationApi.command({ payload: command }));
      case "InviteMember":
        return asRequestError(organizationApi.command({ payload: command }));
      case "RevokeInvitation":
        return asRequestError(organizationApi.command({ payload: command }));
      case "AcceptInvitation":
        return asRequestError(organizationApi.command({ payload: command }));
      case "ChangeMemberRole":
        return asRequestError(organizationApi.command({ payload: command }));
      case "RemoveMember":
        return asRequestError(organizationApi.command({ payload: command }));
    }
  };

  return SessionHttp.of({
    apiBaseUrl,
    authBaseUrl,
    tokens: store,
    setTokens,
    ensureFreshAccess,
    renewAccess,
    settled,
    http,
    workspace: http
      .get(`${apiBaseUrl}/api/auth/session`)
      .pipe(asRequestError, Effect.flatMap(decodeResponse(WorkspaceSnapshot))),
    organizationRoster: asRequestError(organizationApi.roster()),
    organize,
    logout: (tokens) =>
      Effect.suspend(() => {
        const payload = policy.input(tokens);
        return payload === undefined
          ? Effect.void
          : asRequestError(sessionApi.logout({ payload })).pipe(Effect.asVoid);
      }),
  });
});

export const layerSessionHttp = (options: SessionHttpOptions) =>
  Layer.effect(SessionHttp, makeSessionHttp(options));

const apiRequestFor = (apiBaseUrl: string, input: RequestInfo | URL, init?: RequestInit) => {
  const request =
    input instanceof Request
      ? new Request(input, init)
      : new Request(new URL(input.toString(), `${apiBaseUrl}/`), init);
  if (new URL(request.url).origin !== new URL(`${apiBaseUrl}/`).origin) {
    throw new TypeError("Authenticated API requests must use the configured API origin.");
  }
  return request;
};

const asError = (cause: unknown) =>
  cause instanceof Error ? cause : new TypeError("The authenticated request failed.");

const transportCause = (failure: HttpClientError.HttpClientError | RequestError) =>
  Effect.fail(
    HttpClientError.isHttpClientError(failure) &&
      failure.reason._tag === "TransportError" &&
      failure.reason.cause instanceof Error
      ? failure.reason.cause
      : failure,
  );

export const apiFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
): Effect.Effect<Response, Error, SessionHttp> =>
  Effect.gen(function* () {
    const session = yield* SessionHttp;
    const request = yield* Effect.try({
      try: () => apiRequestFor(session.apiBaseUrl, input, init),
      catch: asError,
    });
    const method = request.method.toUpperCase();
    if (!HttpMethod.isHttpMethod(method)) {
      return yield* Effect.fail(new TypeError(`Unsupported request method ${request.method}.`));
    }
    const outgoing = HttpClientRequest.make(method)(request.url, { headers: request.headers });
    const body =
      HttpMethod.hasBody(method) && request.body !== null
        ? yield* Effect.tryPromise({ try: () => request.arrayBuffer(), catch: asError })
        : undefined;
    const response = yield* session.http
      .execute(
        body === undefined
          ? outgoing
          : HttpClientRequest.bodyUint8Array(
              outgoing,
              new Uint8Array(body),
              request.headers.get("content-type") ?? undefined,
            ),
      )
      .pipe(Effect.catch(transportCause));
    const bytes = NULL_BODY_STATUSES.has(response.status)
      ? null
      : yield* response.arrayBuffer.pipe(Effect.catch(transportCause));
    return new Response(bytes, { status: response.status, headers: response.headers });
  });

export type SessionRun = (
  effect: Effect.Effect<Response, Error, SessionHttp>,
  options?: Effect.RunOptions,
) => Promise<Response>;

export const sessionFetch =
  (run: SessionRun): typeof fetch =>
  (input, init) => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    return run(apiFetch(input, init), signal ? { signal } : undefined).catch((cause: unknown) =>
      Promise.reject(signal?.aborted ? signal.reason : cause),
    );
  };
