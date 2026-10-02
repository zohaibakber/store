import { createHash, randomBytes } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import {
  AuthClient,
  AuthorizationCode,
  TokenSet,
  authClientLayer,
  nativeClient,
  type AuthClientError,
  type IdentifyInput,
  type IssuedSession,
  type LoginRoute,
  type OrganizationCommand,
  type OrganizationCommandResult,
  type OrganizationRoster,
} from "@store/auth";
import type { InvoiceExtraction } from "@store/contracts/server-api.schema";
import {
  unauthenticatedWorkspace,
  withWorkspaceOnline,
  WorkspaceSnapshot,
} from "@store/contracts/workspace";
import type { SignInCredentials } from "@store/web/host/index";
import { analyseInvoiceUpload, type InvoiceUploadFile } from "@store/web/host/invoice-upload";
import {
  SessionHttp,
  adoptAuthenticatedSnapshot,
  adoptSessionTokens,
  layerSessionHttp,
  renewSessionSnapshot,
  resumeSessionSnapshot,
  sessionFetch,
  type RequestError,
  type SessionSnapshotHooks,
} from "@store/workspace";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as MutableRef from "effect/MutableRef";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { app, net, safeStorage } from "electron";

import { replacePrivateFile } from "./private-file";

const canPersistEncryptedSession = () =>
  safeStorage.isEncryptionAvailable() &&
  (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text");

const PersistedAuth = Schema.Struct({ snapshot: WorkspaceSnapshot, tokens: TokenSet });
type PersistedAuth = typeof PersistedAuth.Type;

const PersistedAuthJson = Schema.fromJsonString(PersistedAuth);

const unauthenticated = (isOnline: boolean, workspaceError: string | null = null) =>
  unauthenticatedWorkspace({ isOnline, workspaceError });

const netFetch: typeof fetch = (url, init) => net.fetch(url instanceof URL ? url.href : url, init);

const netHttp = FetchHttpClient.layer.pipe(
  Layer.provide(Layer.succeed(FetchHttpClient.Fetch, netFetch)),
);

const persistenceError = (cause: unknown) =>
  cause instanceof Error ? cause : new Error("Could not persist the authenticated session.");

const desktopClient = nativeClient("Tabaaq Desktop");

class GoogleSignInFailure extends Schema.TaggedError<GoogleSignInFailure>()("GoogleSignInFailure", {
  message: Schema.String,
}) {}

const googleCallbackInvalid = () =>
  new GoogleSignInFailure({ message: "The Google callback is invalid." });

const googleSignInNotStarted = () =>
  new GoogleSignInFailure({
    message: "This Google sign-in is no longer active. Choose Continue with Google again.",
  });

const proofKey = Effect.sync(() => {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier: Redacted.make(verifier),
    codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
  };
});

const storagePath = () => path.join(app.getPath("userData"), "auth", "session.bin");

const forgetPersisted = Effect.ignore(Effect.tryPromise(() => rm(storagePath(), { force: true })));

const readPersisted = Effect.gen(function* () {
  const encrypted = yield* Effect.tryPromise(() => readFile(storagePath()));
  const text = yield* Effect.try(() =>
    canPersistEncryptedSession() ? safeStorage.decryptString(encrypted) : undefined,
  );
  return yield* Schema.decodeUnknownEffect(PersistedAuthJson)(text);
}).pipe(Effect.option);

const writePersisted = (value: PersistedAuth) =>
  Effect.gen(function* () {
    const text = yield* Schema.encodeEffect(PersistedAuthJson)(value);
    yield* Effect.tryPromise({
      try: () =>
        canPersistEncryptedSession()
          ? replacePrivateFile(storagePath(), safeStorage.encryptString(text))
          : rm(storagePath(), { force: true }),
      catch: persistenceError,
    });
  });

interface DesktopAuthApi {
  readonly session: Effect.Effect<WorkspaceSnapshot>;
  readonly initialize: Effect.Effect<WorkspaceSnapshot>;
  readonly identify: (input: IdentifyInput) => Effect.Effect<LoginRoute, AuthClientError>;
  readonly authenticate: (
    credentials: SignInCredentials,
  ) => Effect.Effect<WorkspaceSnapshot, AuthClientError>;
  readonly beginGoogle: (redirectUri: string) => Effect.Effect<string, AuthClientError>;
  readonly completeGoogle: (
    code: string,
  ) => Effect.Effect<WorkspaceSnapshot, AuthClientError | GoogleSignInFailure>;
  readonly renewSession: Effect.Effect<WorkspaceSnapshot, RequestError>;
  readonly signOut: Effect.Effect<void>;
  readonly organizationRoster: Effect.Effect<OrganizationRoster, RequestError>;
  readonly organize: (
    command: OrganizationCommand,
  ) => Effect.Effect<OrganizationCommandResult, RequestError>;
  readonly analyseInvoices: (
    files: ReadonlyArray<InvoiceUploadFile>,
  ) => Effect.Effect<InvoiceExtraction, Error | RequestError>;
  readonly liveAccessToken: (force: boolean) => Effect.Effect<string | null, RequestError>;
  readonly withSession: <A, E>(effect: Effect.Effect<A, E, SessionHttp>) => Effect.Effect<A, E>;
}

export class DesktopAuth extends Context.Service<DesktopAuth, DesktopAuthApi>()(
  "@store/desktop/DesktopAuth",
) {}

interface DesktopAuthOptions {
  readonly apiBaseUrl: string;
  readonly authBaseUrl: string;
  readonly publishSession: (snapshot: WorkspaceSnapshot) => void;
}

const makeDesktopAuth = Effect.fnUntraced(function* (options: DesktopAuthOptions) {
  const scope = yield* Effect.scope;
  const snapshot = MutableRef.make<WorkspaceSnapshot>(unauthenticated(false));
  const googleVerifier = yield* Ref.make(Option.none<Redacted.Redacted<string>>());
  const transitions = yield* Semaphore.make(1);

  const hooks: SessionSnapshotHooks = {
    getLocalSnapshot: () => MutableRef.get(snapshot),
    publish: (next) => {
      MutableRef.set(snapshot, next);
      options.publishSession(next);
      return next;
    },
    clearAuthenticated: forgetPersisted,
    persistAuthenticated: (workspace, tokens) =>
      Effect.mapError(writePersisted({ snapshot: workspace, tokens }), persistenceError),
  };

  const sessionHttp = yield* Effect.cached(
    Layer.buildWithScope(
      layerSessionHttp({
        apiBaseUrl: options.apiBaseUrl,
        authBaseUrl: options.authBaseUrl,
        credential: "refreshToken",
        onRefreshed: (refreshed, tokens) =>
          adoptAuthenticatedSnapshot(hooks, refreshed.workspace, tokens).pipe(Effect.asVoid),
        onRejected: Effect.sync(() => hooks.publish(unauthenticated(true))).pipe(
          Effect.andThen(forgetPersisted),
        ),
      }).pipe(Layer.provide(netHttp)),
      scope,
    ).pipe(Effect.uninterruptible),
  );

  const withSession = <A, E>(effect: Effect.Effect<A, E, SessionHttp>): Effect.Effect<A, E> =>
    Effect.flatMap(sessionHttp, (context) => Effect.provideContext(effect, context));

  const signIn = yield* Effect.cached(
    Layer.buildWithScope(
      authClientLayer({ baseUrl: options.authBaseUrl }).pipe(Layer.provide(netHttp)),
      scope,
    ).pipe(Effect.map(Context.get(AuthClient)), Effect.uninterruptible),
  );

  const restored = yield* Effect.cached(
    Effect.tap(readPersisted, (persisted) =>
      Effect.sync(() => {
        if (Option.isSome(persisted)) {
          MutableRef.set(snapshot, withWorkspaceOnline(persisted.value.snapshot, false));
        }
      }),
    ).pipe(Effect.uninterruptible),
  );

  const current = Effect.sync(() => MutableRef.get(snapshot));

  const adopt = (issued: IssuedSession) =>
    transitions.withPermit(withSession(adoptSessionTokens(hooks, issued)));

  const takeGoogleVerifier = Ref.getAndSet(googleVerifier, Option.none()).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(googleSignInNotStarted()),
        onSome: (verifier) => Effect.succeed(verifier),
      }),
    ),
  );

  return DesktopAuth.of({
    session: Effect.andThen(restored, current),
    initialize: Effect.flatMap(
      restored,
      Option.match({
        onNone: () => current,
        onSome: (persisted) => withSession(resumeSessionSnapshot(hooks, persisted.tokens)),
      }),
    ),
    identify: Effect.fn("DesktopAuth.identify")(function* (input: IdentifyInput) {
      const client = yield* signIn;
      return yield* client.identify(input);
    }),
    authenticate: Effect.fn("DesktopAuth.authenticate")(function* (credentials: SignInCredentials) {
      const client = yield* signIn;
      const issued = yield* client.authenticate({ ...credentials, client: desktopClient });
      return yield* adopt(issued);
    }),
    beginGoogle: Effect.fn("DesktopAuth.beginGoogle")(function* (redirectUri: string) {
      const client = yield* signIn;
      const { verifier, codeChallenge } = yield* proofKey;
      const authorization = yield* client.beginGoogle({
        redirectUri,
        codeChallenge,
        client: desktopClient,
      });
      yield* Ref.set(googleVerifier, Option.some(verifier));
      return authorization.url;
    }),
    completeGoogle: Effect.fn("DesktopAuth.completeGoogle")(function* (code: string) {
      const authorizationCode = yield* Schema.decodeUnknownEffect(AuthorizationCode)(code).pipe(
        Effect.mapError(googleCallbackInvalid),
      );
      const verifier = yield* takeGoogleVerifier;
      const client = yield* signIn;
      const issued = yield* client.exchangeGoogle({
        code: authorizationCode,
        codeVerifier: Redacted.value(verifier),
        client: desktopClient,
      });
      return yield* adopt(issued);
    }),
    renewSession: transitions.withPermit(withSession(renewSessionSnapshot(hooks))),
    signOut: transitions.withPermit(
      withSession(
        Effect.gen(function* () {
          const session = yield* SessionHttp;
          yield* session.settled;
          const tokens = yield* session.tokens;
          yield* session.setTokens(null);
          yield* session.logout(tokens).pipe(Effect.ignore);
          hooks.publish(unauthenticated(true));
          yield* forgetPersisted;
        }),
      ),
    ),
    organizationRoster: withSession(SessionHttp.use((session) => session.organizationRoster)),
    organize: (command) => withSession(SessionHttp.use((session) => session.organize(command))),
    analyseInvoices: (files) => withSession(analyseInvoiceUpload(files)),
    liveAccessToken: (force) =>
      withSession(SessionHttp.use((session) => session.ensureFreshAccess(force))).pipe(
        Effect.map((access) => access?.accessToken ?? null),
      ),
    withSession,
  });
});

export const makeAuthBroker = (
  apiBaseUrl: string,
  authBaseUrl: string,
  publishSession: (snapshot: WorkspaceSnapshot) => void,
) => {
  const runtime = ManagedRuntime.make(
    Layer.effect(DesktopAuth, makeDesktopAuth({ apiBaseUrl, authBaseUrl, publishSession })),
  );
  return {
    run: <A, E>(effect: Effect.Effect<A, E, DesktopAuth>) => runtime.runPromise(effect),
    initialize: () => runtime.runPromise(DesktopAuth.use((auth) => auth.initialize)),
    liveAccessToken: (force: boolean) =>
      runtime.runPromise(DesktopAuth.use((auth) => auth.liveAccessToken(force))),
    apiFetch: sessionFetch((effect, options) =>
      runtime.runPromise(
        DesktopAuth.use((auth) => auth.withSession(effect)),
        options,
      ),
    ),
  };
};

export type AuthBroker = ReturnType<typeof makeAuthBroker>;
