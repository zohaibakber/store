import {
  AuthHttpApi,
  TokenSet,
  authHttpErrorStatus,
  sessionEndingCodes,
  type AuthHttpError,
  type IssuedSession,
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
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import { identity } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SynchronizedRef from "effect/SynchronizedRef";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as HttpIncomingMessage from "effect/unstable/http/HttpIncomingMessage";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

const ACCESS_TOKEN_REFRESH_SKEW_MS = 30_000;
const REFRESH_TIMEOUT = Duration.seconds(30);
const INVALID_RESPONSE = "INVALID_RESPONSE";
const NETWORK_ERROR = "NETWORK_ERROR";
const SESSION_SUPERSEDED = "SESSION_SUPERSEDED";

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
  refresh: Schema.optionalKey(Schema.Literals(["failed", "succeeded"])),
}) {}

class ForeignOrigin extends Schema.TaggedError<ForeignOrigin>()("Workspace.ForeignOrigin", {
  message: Schema.String,
}) {}

const RefreshedTokenSet = TokenSet.pipe(
  Schema.fieldsAssign({ workspace: AuthenticatedWorkspaceSnapshot }),
);
interface RefreshedTokenSet extends Schema.Schema.Type<typeof RefreshedTokenSet> {}

type UnrefreshedTokenSet = TokenSet & { readonly workspace?: undefined };

type SessionAccess = RefreshedTokenSet | UnrefreshedTokenSet | null;

const refreshedTokens = (refreshed: TokenSet): TokenSet =>
  Struct.pick(refreshed, ["accessToken", "accessExpiresAt", "refreshToken", "refreshExpiresAt"]);

type RefreshPolicy = (tokens: TokenSet | null, force: boolean, now: number) => boolean;

const isAccessTokenFresh = (tokens: TokenSet | null, now: number) =>
  tokens != null && tokens.accessExpiresAt > now + ACCESS_TOKEN_REFRESH_SKEW_MS;

const cookieSessionNeedsRefresh: RefreshPolicy = (tokens, force, now) =>
  force || !isAccessTokenFresh(tokens, now);

const refreshTokenNeedsRefresh: RefreshPolicy = (tokens, force, now) =>
  !!tokens?.refreshToken && (force || !isAccessTokenFresh(tokens, now));

type SessionCredential = "cookie" | "refreshToken";

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

const requestErrorFromPayload = (payload: Schema.Json | null, status: number): RequestError => {
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

const superseded = () =>
  new RequestError({
    message: "The session changed while the request was in flight.",
    status: 409,
    code: SESSION_SUPERSEDED,
  });

export const isSupersededSession = (error: RequestError) => error.code === SESSION_SUPERSEDED;

const refreshTimedOut = () =>
  new RequestError({
    message: "The session refresh timed out.",
    status: 0,
    code: NETWORK_ERROR,
  });

const withRefresh = (error: RequestError, refresh: "failed" | "succeeded") => {
  const { message, status, code } = error;
  return code === undefined
    ? new RequestError({ message, status, refresh })
    : new RequestError({ message, status, code, refresh });
};

const isSuccessStatus = (status: number) => status >= 200 && status < 300;

export const isRejectedStatus = (status: number) => status === 401 || status === 403;

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
      code: reason._tag === "TransportError" ? NETWORK_ERROR : "INVALID_REQUEST",
    }),
  );
};

type SessionFailure =
  | RequestError
  | HttpClientError.HttpClientError
  | Schema.SchemaError
  | AuthHttpError;

const toRequestError = (failure: SessionFailure): Effect.Effect<RequestError> => {
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

export const asRequestError = <A, R>(effect: Effect.Effect<A, SessionFailure, R>) =>
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

interface SessionHttpOptions {
  readonly apiBaseUrl: string;
  readonly authBaseUrl: string;
  readonly credential: SessionCredential;
  readonly onRefreshed: (refreshed: RefreshedTokenSet, tokens: TokenSet) => Effect.Effect<void>;
  readonly onRejected: Effect.Effect<void>;
  readonly exclusive?: <A, E>(refresh: Effect.Effect<A, E>) => Effect.Effect<A, E>;
}

interface SessionHttpApi {
  readonly apiBaseUrl: string;
  readonly authBaseUrl: string;
  readonly tokens: Effect.Effect<TokenSet | null>;
  readonly setTokens: (tokens: TokenSet | null) => Effect.Effect<void>;
  readonly adopt: (issued: IssuedSession) => Effect.Effect<WorkspaceSnapshot, RequestError>;
  readonly ensureFreshAccess: (force?: boolean) => Effect.Effect<SessionAccess, RequestError>;
  readonly renewAccess: Effect.Effect<RefreshedTokenSet | null, RequestError>;
  readonly settled: Effect.Effect<void>;
  readonly http: HttpClient.HttpClient.With<HttpClientError.HttpClientError | RequestError>;
  readonly fetch: (request: Request) => Effect.Effect<Response, Error>;
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
  readonly done: Deferred.Deferred<RefreshedTokenSet | null, RequestError>;
  readonly fiber: Fiber.Fiber<RefreshedTokenSet | null, RequestError>;
}

interface Principal {
  readonly user: string;
  readonly organization: string | null;
}

interface SessionState {
  readonly owner: number;
  readonly principal: Principal | undefined;
  readonly tokens: TokenSet | null;
  readonly seq: number;
  readonly flight: Flight | undefined;
}

interface Grant {
  readonly owner: number;
  readonly tokens: TokenSet | null;
}

const skipped: Rotation = { _tag: "Skipped" };
const rejected: Rotation = { _tag: "Rejected" };

const decodeWorkspace = Schema.decodeUnknownEffect(AuthenticatedWorkspaceSnapshot);

const issuedWorkspace = Schema.decodeUnknownOption(AuthenticatedWorkspaceSnapshot);

const refreshedSession = (session: RefreshedSession) =>
  decodeWorkspace(session.workspace).pipe(
    Effect.map((workspace): Rotation => ({
      _tag: "Refreshed",
      refreshed: Struct.assign(refreshedTokens(session), { workspace }),
    })),
  );

const principalOf = (workspace: AuthenticatedWorkspaceSnapshot): Principal => ({
  user: workspace.user.id,
  organization: workspace.activeOrganization?.id ?? null,
});

const samePrincipal = (left: Principal, right: Principal) =>
  left.user === right.user && left.organization === right.organization;

const withAccess = (request: HttpClientRequest.HttpClientRequest, tokens: TokenSet | null) =>
  tokens === null ? request : HttpClientRequest.bearerToken(request, tokens.accessToken);

const asError = (cause: unknown) =>
  cause instanceof Error ? cause : new TypeError("The authenticated request failed.");

const discardBody = (response: Response) =>
  Effect.ignore(Effect.tryPromise(() => response.body?.cancel() ?? Promise.resolve()));

const makeSessionHttp = Effect.fnUntraced(function* (options: SessionHttpOptions) {
  const base = yield* HttpClient.HttpClient;
  const fetchWeb = yield* FetchHttpClient.Fetch;
  const scope = yield* Effect.scope;
  const policy = credentialPolicies[options.credential];
  const exclusive = options.exclusive ?? identity;
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  const authBaseUrl = normalizeAuthBaseUrl(options.authBaseUrl);
  const state = yield* SynchronizedRef.make<SessionState>({
    owner: 0,
    principal: undefined,
    tokens: null,
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

  const tokens = Effect.map(SynchronizedRef.get(state), (current) => current.tokens);

  const rotate = exclusive(
    Effect.flatMap(tokens, (current) => {
      const payload = policy.input(current);
      if (payload === undefined) return Effect.succeed(skipped);
      return sessionApi.refresh({ payload }).pipe(
        Effect.timeoutOrElse({
          duration: REFRESH_TIMEOUT,
          orElse: () => Effect.fail(refreshTimedOut()),
        }),
        Effect.flatMap(refreshedSession),
        Effect.catchTag("Unauthenticated", (failure) =>
          sessionEndingCodes.has(failure.error.code)
            ? Effect.succeed(rejected)
            : Effect.fail(failure),
        ),
        asRequestError,
        Effect.mapError((error) => withRefresh(error, "failed")),
      );
    }),
  );

  const commit =
    (current: SessionState, flight: Pick<Flight, "seq">) =>
    (rotation: Rotation): Effect.Effect<readonly [RefreshedTokenSet | null, SessionState]> => {
      if (current.flight?.seq !== flight.seq) {
        return Effect.succeed([null, current] as const);
      }
      switch (rotation._tag) {
        case "Skipped":
          return Effect.succeed([null, { ...current, flight: undefined }] as const);
        case "Rejected":
          return Effect.as(options.onRejected, [
            null,
            { ...current, principal: undefined, tokens: null, flight: undefined },
          ] as const);
        case "Refreshed": {
          const principal = principalOf(rotation.refreshed.workspace);
          const continues =
            current.tokens !== null &&
            (current.principal === undefined || samePrincipal(current.principal, principal));
          const granted = refreshedTokens(rotation.refreshed);
          const next: SessionState = {
            owner: continues ? current.owner : current.owner + 1,
            principal,
            tokens: granted,
            seq: current.seq,
            flight: undefined,
          };
          return Effect.as(options.onRefreshed(rotation.refreshed, granted), [
            rotation.refreshed,
            next,
          ] as const);
        }
      }
    };

  const runFlight = (
    flight: Pick<Flight, "seq" | "done">,
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
      const fiber = yield* Effect.forkIn(runFlight({ seq, done }), scope);
      const flight: Flight = { seq, done, fiber };
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
      const current = yield* tokens;
      if (!policy.needsRefresh(current, force, now)) return current;
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

  const replaceTokens = (next: TokenSet | null, principal: Principal | undefined) =>
    SynchronizedRef.modify(state, (current): readonly [Flight | undefined, SessionState] => [
      current.flight,
      { owner: current.owner + 1, principal, tokens: next, seq: current.seq, flight: undefined },
    ]).pipe(
      Effect.flatMap((flight) =>
        flight === undefined ? Effect.void : Fiber.interrupt(flight.fiber),
      ),
    );

  const setTokens = (next: TokenSet | null) => replaceTokens(next, undefined);

  const currentGrant = Effect.map(SynchronizedRef.get(state), (current): Grant => ({
    owner: current.owner,
    tokens: current.tokens,
  }));

  const rotatedFrom = (grant: Grant, current: Grant) =>
    current.tokens !== null && current.tokens.accessToken !== grant.tokens?.accessToken;

  const authorize = Effect.andThen(ensureFreshAccess(), currentGrant);

  const replayAccess = (grant: Grant): Effect.Effect<TokenSet | null, RequestError> =>
    Effect.gen(function* () {
      const current = yield* currentGrant;
      if (current.owner !== grant.owner || current.tokens === null) return null;
      if (!rotatedFrom(grant, current)) yield* ensureFreshAccess(true);
      const next = yield* currentGrant;
      return next.owner === grant.owner && rotatedFrom(grant, next) ? next.tokens : null;
    });

  const replaying = <A extends { readonly status: number }, E>(
    send: (access: TokenSet | null) => Effect.Effect<A, E>,
    discard: (response: A) => Effect.Effect<void>,
  ) =>
    Effect.gen(function* () {
      const grant = yield* authorize;
      const response = yield* send(grant.tokens);
      if (response.status !== 401) return response;
      const next = yield* replayAccess(grant);
      if (next === null) return response;
      yield* discard(response);
      return yield* send(next);
    });

  const exchange = (request: HttpClientRequest.HttpClientRequest) =>
    replaying(
      (access) => base.execute(withAccess(request, access)),
      () => Effect.void,
    );

  const http = HttpClient.makeWith(
    (request: Effect.Effect<HttpClientRequest.HttpClientRequest>) =>
      Effect.flatMap(request, exchange),
    (request) => Effect.succeed(request),
  ).pipe(
    HttpClient.transformResponse(
      Effect.provideService(FetchHttpClient.RequestInit, { credentials: "omit" }),
    ),
  );

  const sendWeb = (request: Request, access: TokenSet | null) =>
    Effect.tryPromise({
      try: (interrupted) => {
        const headers = new Headers(request.headers);
        if (access !== null) headers.set("authorization", `Bearer ${access.accessToken}`);
        return fetchWeb(
          new Request(request.clone(), {
            credentials: "omit",
            headers,
            signal: AbortSignal.any([request.signal, interrupted]),
          }),
        );
      },
      catch: asError,
    });

  const fetch = (request: Request): Effect.Effect<Response, Error> =>
    replaying((access) => sendWeb(request, access), discardBody);

  const admit = (owner: number, live: boolean, exit: Exit.Exit<WorkspaceSnapshot, RequestError>) =>
    SynchronizedRef.modify(
      state,
      (current): readonly [Exit.Exit<WorkspaceSnapshot, RequestError>, SessionState] => {
        if (current.owner !== owner) return [Exit.fail(superseded()), current];
        if (Exit.isFailure(exit)) return [exit, current];
        if (live && current.tokens === null) return [Exit.fail(superseded()), current];
        const snapshot = exit.value;
        return snapshot.status === "authenticated" && current.principal === undefined
          ? [exit, { ...current, principal: principalOf(snapshot) }]
          : [exit, current];
      },
    );

  const workspace = Effect.gen(function* () {
    const start = yield* currentGrant;
    const exit = yield* http.get(`${apiBaseUrl}/api/auth/session`).pipe(
      asRequestError,
      Effect.flatMap(decodeResponse(WorkspaceSnapshot)),
      Effect.catch((error) =>
        Effect.flatMap(currentGrant, (end) =>
          Effect.fail(
            isRejectedStatus(error.status) &&
              error.refresh === undefined &&
              end.owner === start.owner &&
              rotatedFrom(start, end)
              ? withRefresh(error, "succeeded")
              : error,
          ),
        ),
      ),
      Effect.exit,
    );
    return yield* yield* admit(start.owner, start.tokens !== null, exit);
  });

  const adopt = (issued: IssuedSession): Effect.Effect<WorkspaceSnapshot, RequestError> => {
    const granted = refreshedTokens(issued);
    return Option.match(issuedWorkspace(issued.workspace), {
      onNone: () => Effect.andThen(setTokens(granted), workspace),
      onSome: (snapshot) => Effect.as(replaceTokens(granted, principalOf(snapshot)), snapshot),
    });
  };

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
    tokens,
    setTokens,
    adopt,
    ensureFreshAccess,
    renewAccess,
    settled,
    http,
    fetch,
    workspace,
    organizationRoster: asRequestError(organizationApi.roster()),
    organize,
    logout: (granted) =>
      Effect.suspend(() => {
        const payload = policy.input(granted);
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
  return {
    request,
    foreign: new URL(request.url).origin !== new URL(`${apiBaseUrl}/`).origin,
  };
};

const signalOf = (input: RequestInfo | URL, init?: RequestInit) =>
  init?.signal ?? (input instanceof Request ? input.signal : undefined) ?? undefined;

const apiFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
): Effect.Effect<Response, Error | ForeignOrigin, SessionHttp> =>
  Effect.gen(function* () {
    const session = yield* SessionHttp;
    const { request, foreign } = yield* Effect.try({
      try: () => apiRequestFor(session.apiBaseUrl, input, init),
      catch: asError,
    });
    if (foreign) {
      return yield* new ForeignOrigin({
        message: "Authenticated API requests must use the configured API origin.",
      });
    }
    return yield* session.fetch(request);
  });

type SessionRun = (
  effect: Effect.Effect<Response, Error, SessionHttp>,
  options?: Effect.RunOptions,
) => Promise<Response>;

export const sessionFetch =
  (run: SessionRun): typeof fetch =>
  (input, init) => {
    const signal = signalOf(input, init);
    return run(
      apiFetch(input, init).pipe(
        Effect.catchTag("Workspace.ForeignOrigin", (refused) =>
          Effect.fail(new TypeError(refused.message)),
        ),
      ),
      signal ? { signal } : undefined,
    ).catch((cause: unknown) => Promise.reject(signal?.aborted ? signal.reason : cause));
  };
