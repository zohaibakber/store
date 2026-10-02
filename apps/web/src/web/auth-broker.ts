import { AuthClient, authClientLayer, type IssuedSession } from "@store/auth";
import { unauthenticatedWorkspace, type WorkspaceSnapshot } from "@store/contracts/workspace";
import {
  SessionHttp,
  adoptAuthenticatedSnapshot,
  adoptSessionTokens,
  layerSessionHttp,
  renewSessionSnapshot,
  type RequestError,
  type SessionSnapshotHooks,
} from "@store/workspace";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as MutableRef from "effect/MutableRef";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { browserStore, type KeyValueStorage } from "@/lib/first-party-auth";

const SESSION_EXPECTED_KEY = "tabaaq-web-session-expected";
const REFRESH_LOCK = "tabaaq-web-session-refresh";

export type WebAuthBrokerOptions = {
  readonly apiBaseUrl: string;
  readonly authBaseUrl: string;
  readonly fetch?: typeof fetch;
  readonly storage?: KeyValueStorage;
  readonly isOnline?: () => boolean;
};

const webLocks = Effect.try(() => globalThis.navigator?.locks).pipe(
  Effect.orElseSucceed(() => undefined),
);

const holdRefreshLock = (locks: LockManager) =>
  Effect.acquireRelease(
    Effect.callback<() => void>((resume, signal) => {
      locks
        .request(REFRESH_LOCK, { signal }, () =>
          signal.aborted
            ? Promise.resolve()
            : new Promise<void>((release) => resume(Effect.succeed(release))),
        )
        .catch(() => {
          if (!signal.aborted) resume(Effect.succeed(() => undefined));
        });
    }),
    (release) => Effect.sync(release),
    { interruptible: true },
  );

const oneTabAtATime = <A, E>(refresh: Effect.Effect<A, E>): Effect.Effect<A, E> =>
  Effect.flatMap(webLocks, (locks) =>
    locks === undefined
      ? refresh
      : holdRefreshLock(locks).pipe(Effect.andThen(refresh), Effect.scoped),
  );

export interface WebAuthApi {
  readonly sessionExpected: Effect.Effect<boolean>;
  readonly snapshot: Effect.Effect<WorkspaceSnapshot>;
  readonly initialize: Effect.Effect<WorkspaceSnapshot>;
  readonly adopt: (issued: IssuedSession) => Effect.Effect<WorkspaceSnapshot>;
  readonly renewSession: Effect.Effect<WorkspaceSnapshot, RequestError>;
  readonly signOut: Effect.Effect<void>;
}

export class WebAuth extends Context.Service<WebAuth, WebAuthApi>()("@store/web/WebAuth") {}

export const layerWebAuth = (
  options: WebAuthBrokerOptions,
  publishSession: (snapshot: WorkspaceSnapshot) => void,
): Layer.Layer<WebAuth | SessionHttp | AuthClient> => {
  const send: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const hint = browserStore(() => options.storage ?? globalThis.localStorage);
  const isOnline = options.isOnline ?? (() => globalThis.navigator?.onLine ?? true);
  const snapshot = MutableRef.make<WorkspaceSnapshot>(
    unauthenticatedWorkspace({ isOnline: false }),
  );
  const signedOut = (workspaceError: string | null = null) =>
    unauthenticatedWorkspace({ isOnline: isOnline(), workspaceError });
  const publish = (next: WorkspaceSnapshot) => {
    MutableRef.set(snapshot, next);
    publishSession(next);
    return next;
  };
  const expectSession = Effect.ignore(hint.set(SESSION_EXPECTED_KEY, "1"));
  const sessionExpected = hint.get(SESSION_EXPECTED_KEY).pipe(
    Effect.map(Option.contains("1")),
    Effect.orElseSucceed(() => false),
  );
  const forget = Effect.ignore(hint.remove(SESSION_EXPECTED_KEY)).pipe(
    Effect.andThen(Effect.sync(() => publish(signedOut()))),
    Effect.asVoid,
  );
  const hooks: SessionSnapshotHooks = {
    getLocalSnapshot: () => MutableRef.get(snapshot),
    publish,
    clearAuthenticated: forget,
  };

  const auth = Layer.effect(
    WebAuth,
    Effect.gen(function* () {
      const session = yield* SessionHttp;
      const transitions = yield* Semaphore.make(1);
      const transition = <A, E>(effect: Effect.Effect<A, E, SessionHttp>) =>
        transitions.withPermit(Effect.provideService(effect, SessionHttp, session));
      return WebAuth.of({
        sessionExpected,
        snapshot: Effect.sync(() => MutableRef.get(snapshot)),
        initialize: Effect.flatMap(sessionExpected, (expected) =>
          expected
            ? session.ensureFreshAccess(true).pipe(
                Effect.match({
                  onFailure: (error) => publish(signedOut(error.message)),
                  onSuccess: () => MutableRef.get(snapshot),
                }),
              )
            : Effect.sync(() => publish(signedOut())),
        ),
        adopt: (issued) =>
          transition(Effect.andThen(expectSession, adoptSessionTokens(hooks, issued))),
        renewSession: transition(renewSessionSnapshot(hooks)),
        signOut: transition(
          Effect.gen(function* () {
            yield* session.settled;
            yield* session.setTokens(null);
            yield* forget;
            yield* session.logout(null).pipe(Effect.ignore);
          }),
        ),
      });
    }),
  );

  return auth.pipe(
    Layer.provideMerge(
      layerSessionHttp({
        apiBaseUrl: options.apiBaseUrl,
        authBaseUrl: options.authBaseUrl,
        credential: "cookie",
        onRefreshed: (refreshed, tokens) =>
          expectSession.pipe(
            Effect.andThen(adoptAuthenticatedSnapshot(hooks, refreshed.workspace, tokens)),
            Effect.asVoid,
          ),
        onRejected: forget,
        exclusive: oneTabAtATime,
      }),
    ),
    Layer.merge(authClientLayer({ baseUrl: options.authBaseUrl })),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, send)),
  );
};
