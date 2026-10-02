import {
  AuthClient,
  EmailAddress,
  GoogleIdToken,
  InvitationToken,
  OrganizationId,
  OrganizationName,
  OtpCode,
  Password,
  authClientLayer,
  normalizeEmail,
  type AuthClientApi,
  type AuthClientError,
  type AuthClientKind,
  type IssuedSession,
  type LoginRoute,
  type OrganizationCommand,
  type TokenSet,
} from "@store/auth";
import type { WorkspaceSnapshot } from "@store/contracts/workspace";
import { RequestError, SessionHttp, layerSessionHttp, sessionFetch } from "@store/workspace";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FiberSet from "effect/FiberSet";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  SESSION_ENDED_NOTICE,
  accountFromWorkspace,
  canRenameOrganization,
  initialAuthState,
  transition,
  type Account,
  type AuthEvent,
  type AuthState,
  type LastOrganization,
  type StoredSession,
} from "./model";
import {
  describeFailure,
  failureFacts,
  invalid,
  isNetworkFailure,
  problem,
  type AuthProblem,
  type FailureContext,
  type FailureFacts,
} from "./problems";
import type { LiveAccessToken, Session } from "./session";

interface SignInFlow {
  readonly route: LoginRoute;
  readonly issuedAt: number;
}

type ActionResult =
  | { readonly _tag: "Done" }
  | { readonly _tag: "Failed"; readonly problem: AuthProblem };

export type IdentifyResult =
  | { readonly _tag: "Routed"; readonly route: LoginRoute["_tag"] }
  | { readonly _tag: "Failed"; readonly problem: AuthProblem };

type GoogleSignInResult = ActionResult | { readonly _tag: "Cancelled" };

export type GoogleIdTokenResult =
  | { readonly _tag: "Token"; readonly idToken: string }
  | { readonly _tag: "Cancelled" }
  | { readonly _tag: "Failed"; readonly message: string };

export interface GoogleIdentity {
  readonly requestIdToken: () => Promise<GoogleIdTokenResult>;
  readonly forget: () => Promise<void>;
}

export interface SessionVault {
  readonly load: () => Promise<StoredSession | null>;
  readonly save: (session: StoredSession) => Promise<void>;
  readonly clear: () => Promise<void>;
  readonly loadLastOrganization: () => Promise<LastOrganization | null>;
  readonly saveLastOrganization: (value: LastOrganization) => Promise<void>;
}

interface AuthControllerOptions {
  readonly apiBaseUrl: string;
  readonly authBaseUrl: string;
  readonly fetch: typeof fetch;
  readonly vault: SessionVault;
  readonly isOnline: () => Promise<boolean>;
  readonly google: GoogleIdentity | null;
  readonly client: AuthClientKind;
}

export interface AuthController {
  readonly getState: () => AuthState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getFlow: () => SignInFlow | null;
  readonly subscribeFlow: (listener: () => void) => () => void;
  readonly start: () => Promise<void>;
  readonly googleAvailable: boolean;
  readonly identify: (email: string) => Promise<IdentifyResult>;
  readonly resendCode: () => Promise<ActionResult>;
  readonly verifyCode: (code: string) => Promise<ActionResult>;
  readonly signInWithPassword: (password: string) => Promise<ActionResult>;
  readonly createAccount: (input: {
    readonly name: string;
    readonly password: string;
  }) => Promise<ActionResult>;
  readonly signInWithGoogle: () => Promise<GoogleSignInResult>;
  readonly confirmOrganization: (input: { readonly name?: string }) => Promise<ActionResult>;
  readonly joinOrganization: (invitation: string) => Promise<ActionResult>;
  readonly signOut: () => Promise<void>;
  readonly authenticatedFetch: typeof fetch;
  readonly liveAccessToken: LiveAccessToken;
}

const done: ActionResult = { _tag: "Done" };

type Failed = { readonly _tag: "Failed"; readonly problem: AuthProblem };

const failed = (reason: AuthProblem): Failed => ({ _tag: "Failed", problem: reason });

const startAgain = () => failed(invalid("Start again with your email."));

const sessionEnded = failed(problem("sessionEnded", SESSION_ENDED_NOTICE));

const isSessionRejection = (status: number) => status === 401 || status === 403;

class SessionWork extends Context.Service<SessionWork, FiberSet.FiberSet<ActionResult, never>>()(
  "@store/mobile/auth/SessionWork",
) {}

const sessionVault = (vault: SessionVault) => ({
  session: Effect.tryPromise(() => vault.load()).pipe(Effect.orElseSucceed(() => null)),
  lastOrganization: Effect.tryPromise(() => vault.loadLastOrganization()).pipe(
    Effect.orElseSucceed(() => null),
  ),
  save: (session: StoredSession) => Effect.ignore(Effect.tryPromise(() => vault.save(session))),
  clear: Effect.ignore(Effect.tryPromise(() => vault.clear())),
  rememberOrganization: (value: LastOrganization) =>
    Effect.ignore(Effect.tryPromise(() => vault.saveLastOrganization(value))),
});

const valid = <A>(schema: Schema.Codec<A, unknown>, input: string, reason: AuthProblem) =>
  Effect.mapError(Schema.decodeUnknownEffect(schema)(input), () => failed(reason));

const settled = <A, R>(action: Effect.Effect<A, Failed, R>) =>
  Effect.catch(action, (failure) => Effect.succeed(failure));

export const createAuthController = (options: AuthControllerOptions): AuthController => {
  const registry = AtomRegistry.make();
  const stateAtom = Atom.make<AuthState>(initialAuthState).pipe(Atom.keepAlive);
  const flowAtom = Atom.make<SignInFlow | null>(null).pipe(Atom.keepAlive);
  let started: Promise<void> | null = null;

  const getState = () => registry.get(stateAtom);
  const getFlow = () => registry.get(flowAtom);
  const setFlow = (flow: SignInFlow | null) => registry.set(flowAtom, flow);
  const dispatch = (event: AuthEvent) => {
    const current = getState();
    const next = transition(current, event);
    if (next !== current) registry.set(stateAtom, next);
  };
  const activeAccount = () => {
    const state = getState();
    return state._tag === "Active" ? state.account : null;
  };

  const vault = sessionVault(options.vault);

  const online = Effect.tryPromise(() => options.isOnline()).pipe(Effect.orElseSucceed(() => true));

  const failedWith = (facts: FailureFacts, codeIssuedAt?: number) =>
    Effect.map(isNetworkFailure(facts) ? online : Effect.succeed(true), (isOnline) => {
      const context: FailureContext =
        codeIssuedAt === undefined
          ? { online: isOnline, now: Date.now() }
          : { online: isOnline, now: Date.now(), codeIssuedAt };
      return failed(describeFailure(facts, context));
    });

  const rejecting =
    (codeIssuedAt?: number) =>
    <A, R>(attempt: Effect.Effect<A, AuthClientError | RequestError, R>) =>
      Effect.catch(attempt, (cause) =>
        Effect.flatMap(failedWith(failureFacts(cause), codeIssuedAt), Effect.fail),
      );

  const persist = (account: Account, tokens: TokenSet | null) =>
    tokens === null
      ? Effect.void
      : Effect.uninterruptible(vault.save({ version: 1, tokens, account }));

  const adoptAccount = Effect.fn("MobileAuth.adoptAccount")(function* (
    account: Account,
    tokens: TokenSet | null,
  ) {
    yield* persist(account, tokens);
    const remembered = yield* vault.lastOrganization;
    dispatch({ _tag: "AccountRefreshed", account, lastOrganization: remembered });
  });

  const leaveSession = (event: AuthEvent) =>
    Effect.gen(function* () {
      const session = yield* SessionHttp;
      yield* session.setTokens(null);
      setFlow(null);
      dispatch(event);
      yield* SessionWork.use(FiberSet.clear);
      yield* vault.clear;
    });

  const endSession = Effect.sync(() => {
    runtime.runFork(leaveSession({ _tag: "SessionEnded" }));
  });

  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      layerSessionHttp({
        apiBaseUrl: options.apiBaseUrl,
        authBaseUrl: options.authBaseUrl,
        credential: "refreshToken",
        onRefreshed: (refreshed, tokens) =>
          activeAccount() === null
            ? Effect.void
            : adoptAccount(accountFromWorkspace(refreshed.workspace), tokens),
        onRejected: endSession,
      }),
      authClientLayer({ baseUrl: options.authBaseUrl }),
      Layer.effect(SessionWork, FiberSet.make<ActionResult, never>()),
    ).pipe(
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, options.fetch)),
    ),
  );

  const inSession = (
    work: Effect.Effect<ActionResult, never, SessionHttp>,
    whenInterrupted: ActionResult,
  ) =>
    SessionWork.use((sessionWork) => FiberSet.run(sessionWork, work)).pipe(
      Effect.flatMap(Fiber.await),
      Effect.flatMap((exit) => (Exit.hasInterrupts(exit) ? Effect.succeed(whenInterrupted) : exit)),
    );

  const accountOf = (snapshot: WorkspaceSnapshot) =>
    snapshot.status === "authenticated"
      ? Effect.succeed(accountFromWorkspace(snapshot))
      : Effect.fail(
          new RequestError({
            status: 401,
            code: "UNAUTHENTICATED",
            message: "Sign in to continue.",
          }),
        );

  const fetchAccount = Effect.gen(function* () {
    const session = yield* SessionHttp;
    const refreshed = yield* session.ensureFreshAccess();
    if (refreshed?.workspace !== undefined) return accountFromWorkspace(refreshed.workspace);
    return yield* Effect.flatMap(session.workspace, accountOf);
  });

  const confirmSession = Effect.fn("MobileAuth.confirmSession")(function* (
    rejection: RequestError,
  ) {
    const session = yield* SessionHttp;
    const confirmed = yield* Effect.result(session.ensureFreshAccess(true));
    if (Result.isFailure(confirmed)) return yield* failedWith(failureFacts(confirmed.failure));
    if (confirmed.success?.workspace !== undefined) return done;
    return yield* failedWith(failureFacts(rejection));
  });

  const refreshAccount = Effect.fn("MobileAuth.refreshAccount")(function* () {
    const loaded = yield* Effect.result(fetchAccount);
    if (Result.isFailure(loaded)) {
      const rejection = loaded.failure;
      return rejection.refresh === undefined && isSessionRejection(rejection.status)
        ? yield* confirmSession(rejection)
        : yield* failedWith(failureFacts(rejection));
    }
    if (getState()._tag !== "Active") return done;
    const session = yield* SessionHttp;
    yield* adoptAccount(loaded.success, yield* session.tokens);
    return done;
  });

  const organize = (command: OrganizationCommand) =>
    SessionHttp.use((session) =>
      Effect.flatMap(session.organize(command), (result) =>
        Effect.map(session.renewAccess, (renewed) => ({ result, renewed })),
      ),
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.flatMap(failedWith(failureFacts(Cause.squash(cause))), Effect.fail),
      ),
    );

  const signInWith = Effect.fn("MobileAuth.signInWith")(function* (issued: IssuedSession) {
    const session = yield* SessionHttp;
    const loaded = yield* Effect.result(Effect.flatMap(session.adopt(issued), accountOf));
    if (Result.isFailure(loaded)) {
      yield* session.setTokens(null);
      yield* Effect.forkDetach(Effect.ignore(session.logout(issued)));
      return yield* failedWith(failureFacts(loaded.failure));
    }
    yield* persist(loaded.success, yield* session.tokens);
    const remembered = yield* vault.lastOrganization;
    setFlow(null);
    dispatch({ _tag: "SignedIn", account: loaded.success, lastOrganization: remembered });
    return done;
  });

  const adopt = (issued: IssuedSession) =>
    Effect.andThen(SessionWork.use(FiberSet.clear), inSession(signInWith(issued), done));

  const signIn = (
    exchange: (client: AuthClientApi) => Effect.Effect<IssuedSession, AuthClientError>,
    codeIssuedAt?: number,
  ) => AuthClient.use(exchange).pipe(rejecting(codeIssuedAt), Effect.flatMap(adopt));

  const identify = Effect.fn("MobileAuth.identify")(function* (email: string) {
    const address = yield* valid(
      EmailAddress,
      normalizeEmail(email),
      invalid("Enter a valid email address.", "email"),
    );
    const route = yield* AuthClient.use((client) => client.identify({ email: address })).pipe(
      rejecting(),
    );
    setFlow({ route, issuedAt: Date.now() });
    const routed: IdentifyResult = { _tag: "Routed", route: route._tag };
    return routed;
  }, settled);

  const resendCode = Effect.fn("MobileAuth.resendCode")(function* () {
    const route = getFlow()?.route;
    if (route?._tag !== "Otp") return startAgain();
    const result = yield* identify(route.email);
    return result._tag === "Failed" ? result : done;
  });

  const verifyCode = Effect.fn("MobileAuth.verifyCode")(function* (code: string) {
    const flow = getFlow();
    const route = flow?.route;
    if (flow === null || route?._tag !== "Otp") return startAgain();
    const otp = yield* valid(OtpCode, code.trim(), invalid("Enter the 6-digit code.", "code"));
    return yield* signIn(
      (client) =>
        client.authenticate({
          _tag: "Otp",
          challengeId: route.challengeId,
          code: otp,
          client: options.client,
        }),
      flow.issuedAt,
    );
  }, settled);

  const signInWithPassword = Effect.fn("MobileAuth.signInWithPassword")(function* (
    password: string,
  ) {
    const route = getFlow()?.route;
    if (route?._tag !== "Password") return startAgain();
    if (password.length === 0) return failed(invalid("Enter your password.", "password"));
    const decoded = yield* valid(Password, password, {
      kind: "wrongPassword",
      message: "That password isn't right.",
      field: "password",
    });
    return yield* signIn((client) =>
      client.authenticate({
        _tag: "Password",
        email: route.email,
        password: decoded,
        client: options.client,
      }),
    );
  }, settled);

  const createAccount = Effect.fn("MobileAuth.createAccount")(function* (input: {
    readonly name: string;
    readonly password: string;
  }) {
    const route = getFlow()?.route;
    if (route?._tag !== "Registration") return startAgain();
    const name = input.name.trim();
    if (name.length === 0 || name.length > 100) {
      return failed(invalid("Enter your name.", "name"));
    }
    const password = yield* valid(
      Password,
      input.password,
      invalid("Use 10 to 100 characters, with no spaces at the start or end.", "password"),
    );
    return yield* signIn((client) =>
      client.authenticate({
        _tag: "RegisterPassword",
        email: route.email,
        name,
        password,
        client: options.client,
      }),
    );
  }, settled);

  const signInWithGoogle = Effect.fn("MobileAuth.signInWithGoogle")(function* () {
    const google = options.google;
    if (google === null) {
      return failed(problem("unavailable", "Google sign-in isn't set up in this build."));
    }
    const identity = yield* Effect.promise(() => google.requestIdToken());
    if (identity._tag === "Cancelled") return identity;
    if (identity._tag === "Failed") return failed(problem("rejected", identity.message));
    const idToken = yield* valid(
      GoogleIdToken,
      identity.idToken,
      problem("rejected", "Google sign-in didn't finish. Try again."),
    );
    return yield* signIn((client) =>
      client.exchangeGoogleIdToken({ idToken, client: options.client }),
    );
  }, settled);

  const confirm = (account: Account, organizationId: string) =>
    vault
      .rememberOrganization({ userId: account.userId, organizationId })
      .pipe(
        Effect.andThen(
          Effect.sync(() => dispatch({ _tag: "OrganizationConfirmed", organizationId })),
        ),
      );

  const rename = Effect.fn("MobileAuth.rename")(function* (
    organization: NonNullable<Account["organization"]>,
    desired: string,
  ) {
    const name = yield* valid(
      OrganizationName,
      desired,
      invalid("Use 2 to 60 characters for the store name.", "organizationName"),
    );
    const organizationId = yield* valid(
      OrganizationId,
      organization.id,
      problem("rejected", "This store can't be renamed."),
    );
    const { renewed } = yield* organize({
      _tag: "UpdateOrganization",
      organizationId,
      name,
    });
    return renewed === null ? sessionEnded : done;
  }, settled);

  const confirmOrganization = Effect.fn("MobileAuth.confirmOrganization")(function* (input: {
    readonly name?: string;
  }) {
    const account = activeAccount();
    const organization = account?.organization ?? null;
    if (account === null || organization === null) {
      return failed(invalid("Join a store to continue.", "invitation"));
    }
    const desired = input.name?.trim();
    if (
      desired !== undefined &&
      desired !== organization.name &&
      canRenameOrganization(organization.role)
    ) {
      const renamed = yield* rename(organization, desired);
      if (renamed._tag === "Failed") return renamed;
    }
    yield* confirm(account, organization.id);
    return done;
  });

  const joinOrganization = Effect.fn("MobileAuth.joinOrganization")(function* (invitation: string) {
    const token = yield* valid(
      InvitationToken,
      invitation.trim(),
      invalid("Paste the invitation code you were sent.", "invitation"),
    );
    const { result, renewed } = yield* organize({ _tag: "AcceptInvitation", token });
    if (result._tag !== "Joined") {
      return failed(problem("rejected", "The invitation could not be used."));
    }
    if (renewed === null) return sessionEnded;
    const account = activeAccount();
    if (account?.organization?.id !== result.organization.id) {
      return failed(problem("unavailable", "You joined the store. Try again in a moment."));
    }
    yield* confirm(account, result.organization.id);
    return done;
  }, settled);

  const signOut = Effect.fn("MobileAuth.signOut")(function* () {
    const session = yield* SessionHttp;
    const signedIn = yield* session.tokens;
    yield* session.settled;
    yield* leaveSession({ _tag: "SignedOut" });
    const google = options.google;
    if (google !== null) yield* Effect.ignore(Effect.tryPromise(() => google.forget()));
    yield* Effect.forkDetach(Effect.ignore(session.logout(signedIn)));
  });

  const restore = Effect.fn("MobileAuth.restore")(function* () {
    const [stored, remembered] = yield* Effect.all([vault.session, vault.lastOrganization], {
      concurrency: "unbounded",
    });
    if (stored !== null) yield* SessionHttp.use((session) => session.setTokens(stored.tokens));
    dispatch({ _tag: "Restored", account: stored?.account ?? null, lastOrganization: remembered });
    if (stored !== null) {
      yield* SessionWork.use((sessionWork) => FiberSet.run(sessionWork, refreshAccount()));
    }
  });

  const start = () => {
    if (started === null) started = runtime.runPromise(restore());
    return started;
  };

  return {
    getState,
    subscribe: (listener) => registry.subscribe(stateAtom, listener),
    getFlow,
    subscribeFlow: (listener) => registry.subscribe(flowAtom, listener),
    start,
    googleAvailable: options.google !== null,
    identify: (email) => runtime.runPromise(identify(email)),
    resendCode: () => runtime.runPromise(resendCode()),
    verifyCode: (code) => runtime.runPromise(verifyCode(code)),
    signInWithPassword: (password) => runtime.runPromise(signInWithPassword(password)),
    createAccount: (input) => runtime.runPromise(createAccount(input)),
    signInWithGoogle: () => runtime.runPromise(signInWithGoogle()),
    confirmOrganization: (input) => runtime.runPromise(confirmOrganization(input)),
    joinOrganization: (invitation) => runtime.runPromise(joinOrganization(invitation)),
    signOut: () => runtime.runPromise(signOut()),
    authenticatedFetch: sessionFetch((effect, runOptions) =>
      runtime.runPromise(effect, runOptions),
    ),
    liveAccessToken: ({ force }) =>
      runtime.runPromise(
        SessionHttp.use((session) => session.ensureFreshAccess(force)).pipe(
          Effect.map((access) => access?.accessToken ?? null),
        ),
      ),
  };
};

export const toSession = (
  state: AuthState,
  controller: Pick<AuthController, "authenticatedFetch" | "liveAccessToken" | "signOut">,
): Session => {
  switch (state._tag) {
    case "Loading":
      return { status: "loading" };
    case "SignedOut":
      return state.notice === null
        ? { status: "signedOut" }
        : { status: "signedOut", notice: state.notice };
    case "Active": {
      const { account } = state;
      if (!state.confirmed || account.organization === null) {
        return {
          status: "needsOrganization",
          userId: account.userId,
          email: account.email,
          displayName: account.displayName,
          organization: account.organization,
          signOut: controller.signOut,
        };
      }
      return {
        status: "signedIn",
        userId: account.userId,
        email: account.email,
        displayName: account.displayName,
        organizationId: account.organization.id,
        organizationName: account.organization.name,
        authenticatedFetch: controller.authenticatedFetch,
        liveAccessToken: controller.liveAccessToken,
        signOut: controller.signOut,
      };
    }
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
};
