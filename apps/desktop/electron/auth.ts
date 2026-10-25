import path from "node:path";

import {
  AuthClient,
  AuthorizationCode,
  TokenSet,
  nativeClient,
  type AuthClientError,
  type IdentifyInput,
  type IssuedSession,
  type LoginRoute,
  type OrganizationCommand,
  type OrganizationCommandResult,
  type OrganizationRoster,
} from "@store/auth";
import type {
  GlobalProductSearchResult,
  InvoiceExtraction,
} from "@store/contracts/server-api.schema";
import {
  unauthenticatedWorkspace,
  withWorkspaceOnline,
  WorkspaceSnapshot,
} from "@store/contracts/workspace";
import {
  SessionHttp,
  adoptAuthenticatedSnapshot,
  adoptSessionTokens,
  layerSessionHttp,
  renewSessionSnapshot,
  resumeSessionSnapshot,
  type RequestError,
  type SessionSnapshotHooks,
} from "@store/workspace";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as MutableRef from "effect/MutableRef";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { app, net, safeStorage } from "electron";

import { searchGlobalProducts } from "../src/host/global-search";
import type { SignInCredentials } from "../src/host/index";
import { analyseInvoiceUpload, type InvoiceUploadFile } from "../src/host/invoice-upload";
import { cachedOnSuccess } from "./cached-on-success";
import { PrivateFiles } from "./private-files";
import { ShellEvents } from "./shell-events";

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

const googleProofFailed = () =>
  new GoogleSignInFailure({ message: "Could not start Google sign-in." });

const PkceChallenge = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/u)).pipe(
  Schema.brand("PkceChallenge"),
);

const proofKey = Effect.fnUntraced(function* (crypto: Crypto.Crypto) {
  const verifier = Base64Url.encode(yield* crypto.randomBytes(32));
  const digest = yield* crypto.digest("SHA-256", new TextEncoder().encode(verifier));
  const codeChallenge = yield* Schema.decodeUnknownEffect(PkceChallenge)(Base64Url.encode(digest));
  return { verifier: Redacted.make(verifier), codeChallenge };
}, Effect.mapError(googleProofFailed));

const storagePath = () => path.join(app.getPath("userData"), "auth", "session.bin");

const persistence = (files: PrivateFiles["Service"]) => ({
  forgetPersisted: Effect.ignore(files.remove(storagePath())),
  readPersisted: Effect.gen(function* () {
    const encrypted = yield* files.readBytes(storagePath());
    const text = yield* Effect.try(() =>
      canPersistEncryptedSession() && Option.isSome(encrypted)
        ? safeStorage.decryptString(Buffer.from(encrypted.value))
        : undefined,
    );
    return yield* Schema.decodeUnknownEffect(PersistedAuthJson)(text);
  }).pipe(Effect.option),
  writePersisted: (value: PersistedAuth) =>
    Effect.gen(function* () {
      const text = yield* Schema.encodeEffect(PersistedAuthJson)(value);
      yield* canPersistEncryptedSession()
        ? files.replace(storagePath(), safeStorage.encryptString(text))
        : files.remove(storagePath());
    }),
});

export interface DesktopAuthOptions {
  readonly apiBaseUrl: string;
  readonly authBaseUrl: string;
}

const makeDesktopAuth = Effect.fnUntraced(function* (options: DesktopAuthOptions) {
  const { forgetPersisted, readPersisted, writePersisted } = persistence(yield* PrivateFiles);
  const crypto = yield* Crypto.Crypto;
  const events = yield* ShellEvents;
  const scope = yield* Effect.scope;
  const snapshot = MutableRef.make<WorkspaceSnapshot>(unauthenticated(false));
  const googleVerifier = yield* Ref.make(Option.none<Redacted.Redacted<string>>());
  const transitions = yield* Semaphore.make(1);
  const accessTokens = yield* PubSub.unbounded<Redacted.Redacted<string> | null>();

  const hooks: SessionSnapshotHooks = {
    getLocalSnapshot: () => MutableRef.get(snapshot),
    publish: (next) => {
      MutableRef.set(snapshot, next);
      PubSub.publishUnsafe(events.session, next);
      return next;
    },
    clearAuthenticated: forgetPersisted,
    persistAuthenticated: (workspace, tokens) =>
      Effect.mapError(writePersisted({ snapshot: workspace, tokens }), persistenceError),
  };

  const sessionHttp = yield* cachedOnSuccess(
    Layer.buildWithScope(
      layerSessionHttp({
        apiBaseUrl: options.apiBaseUrl,
        authBaseUrl: options.authBaseUrl,
        onRefreshed: (refreshed, tokens) =>
          adoptAuthenticatedSnapshot(hooks, refreshed.workspace, tokens).pipe(
            Effect.andThen(PubSub.publish(accessTokens, Redacted.make(tokens.accessToken))),
          ),
        onRejected: Effect.sync(() => hooks.publish(unauthenticated(true))).pipe(
          Effect.andThen(PubSub.publish(accessTokens, null)),
          Effect.andThen(forgetPersisted),
        ),
      }).pipe(Layer.provide(netHttp)),
      scope,
    ).pipe(Effect.uninterruptible),
  );

  const withSession = <A, E>(effect: Effect.Effect<A, E, SessionHttp>): Effect.Effect<A, E> =>
    Effect.flatMap(sessionHttp, (context) => Effect.provideContext(effect, context));

  const signIn = yield* cachedOnSuccess(
    Layer.buildWithScope(
      AuthClient.layer({ baseUrl: options.authBaseUrl }).pipe(Layer.provide(netHttp)),
      scope,
    ).pipe(Effect.map(Context.get(AuthClient)), Effect.uninterruptible),
  );

  const restored = yield* cachedOnSuccess(
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
    ).pipe(Effect.tap((initial) => PubSub.publish(events.session, initial))),
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
      const { verifier, codeChallenge } = yield* proofKey(crypto);
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
          yield* PubSub.publish(accessTokens, null);
          yield* forgetPersisted;
        }),
      ),
    ),
    organizationRoster: withSession(SessionHttp.use((session) => session.organizationRoster)),
    organize: (command) => withSession(SessionHttp.use((session) => session.organize(command))),
    analyseInvoices: (files) => withSession(analyseInvoiceUpload(files)),
    searchGlobalProducts: (query) => withSession(searchGlobalProducts(query)),
    accessTokens: Stream.fromPubSub(accessTokens),
    liveAccessToken: (force) =>
      withSession(SessionHttp.use((session) => session.ensureFreshAccess(force))).pipe(
        Effect.map((access) => (access === null ? null : Redacted.make(access.accessToken))),
      ),
    withSession,
  });
});

export class DesktopAuth extends Context.Service<
  DesktopAuth,
  {
    readonly session: Effect.Effect<WorkspaceSnapshot>;
    readonly initialize: Effect.Effect<WorkspaceSnapshot>;
    readonly identify: (input: IdentifyInput) => Effect.Effect<LoginRoute, AuthClientError>;
    readonly authenticate: (
      credentials: SignInCredentials,
    ) => Effect.Effect<WorkspaceSnapshot, AuthClientError>;
    readonly beginGoogle: (
      redirectUri: string,
    ) => Effect.Effect<string, AuthClientError | GoogleSignInFailure>;
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
    readonly searchGlobalProducts: (
      query: string,
    ) => Effect.Effect<GlobalProductSearchResult, Error | RequestError>;
    readonly accessTokens: Stream.Stream<Redacted.Redacted<string> | null>;
    readonly liveAccessToken: (
      force: boolean,
    ) => Effect.Effect<Redacted.Redacted<string> | null, RequestError>;
    readonly withSession: <A, E>(effect: Effect.Effect<A, E, SessionHttp>) => Effect.Effect<A, E>;
  }
>()("@store/desktop/DesktopAuth") {
  static readonly layer = (options: DesktopAuthOptions) =>
    Layer.effect(DesktopAuth, makeDesktopAuth(options));
}
