import {
  EmailAddress,
  GoogleIdToken,
  InvitationToken,
  OrganizationId,
  OrganizationName,
  OrganizationSlug,
  OtpCode,
  Password,
  normalizeEmail,
  type AuthClientApi,
  type AuthClientError,
  type AuthClientKind,
  type LoginRoute,
  type TokenSet,
} from "@store/auth";
import { AuthenticatedWorkspaceSnapshot, WorkspaceSnapshot } from "@store/contracts/workspace";
import {
  MemoryTokenStore,
  RequestError,
  SessionHttpClient,
  organizeOrganization,
  refreshedTokens,
  refreshTokenNeedsRefresh,
  type JsonRequestInit,
  type RefreshedTokenSet,
} from "@store/workspace";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FiberSet from "effect/FiberSet";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Struct from "effect/Struct";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { makeAuthenticatedFetch } from "./authenticated-fetch";
import {
  SESSION_ENDED_NOTICE,
  accountFromWorkspace,
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
  endsSession,
  failureFacts,
  invalid,
  isNetworkFailure,
  problem,
  rejectsRefresh,
  type AuthProblem,
  type FailureContext,
  type FailureFacts,
} from "./problems";
import type { LiveAccessToken, Session } from "./session";

export interface SignInFlow {
  readonly route: LoginRoute;
  readonly issuedAt: number;
}

export type ActionResult =
  | { readonly _tag: "Done" }
  | { readonly _tag: "Failed"; readonly problem: AuthProblem };

export type IdentifyResult =
  | { readonly _tag: "Routed"; readonly route: LoginRoute["_tag"] }
  | { readonly _tag: "Failed"; readonly problem: AuthProblem };

export type GoogleSignInResult = ActionResult | { readonly _tag: "Cancelled" };

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

export interface AuthControllerOptions {
  readonly apiBaseUrl: string;
  readonly authBaseUrl: string;
  readonly fetch: typeof fetch;
  readonly authClient: AuthClientApi;
  readonly vault: SessionVault;
  readonly isOnline: () => Promise<boolean>;
  readonly google: GoogleIdentity | null;
  readonly client: AuthClientKind;
  readonly now?: () => number;
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

const run = <A>(effect: Effect.Effect<A, AuthClientError>) =>
  Effect.runPromise(Effect.result(effect));

const canRename = (role: string) => role === "owner" || role === "admin";

const decodeSnapshot = Schema.decodeUnknownOption(WorkspaceSnapshot);

const decodeRefreshedWorkspace = Schema.decodeUnknownEffect(AuthenticatedWorkspaceSnapshot);

const sessionEnded = failed(problem("sessionEnded", SESSION_ENDED_NOTICE));

export const createAuthController = (options: AuthControllerOptions): AuthController => {
  const now = options.now ?? Date.now;
  const registry = AtomRegistry.make();
  const stateAtom = Atom.make<AuthState>(initialAuthState).pipe(Atom.keepAlive);
  const flowAtom = Atom.make<SignInFlow | null>(null).pipe(Atom.keepAlive);
  const tokens = new MemoryTokenStore();
  const sessionWork = Effect.runSync(
    FiberSet.make<ActionResult | RefreshedTokenSet | null, AuthClientError>().pipe(
      Scope.provide(Scope.makeUnsafe()),
    ),
  );
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

  const describe = async (facts: FailureFacts, codeIssuedAt?: number) => {
    const online = isNetworkFailure(facts) ? await options.isOnline().catch(() => true) : true;
    const context: FailureContext =
      codeIssuedAt === undefined ? { online, now: now() } : { online, now: now(), codeIssuedAt };
    return describeFailure(facts, context);
  };

  const failure = async (cause: unknown, codeIssuedAt?: number) =>
    failed(await describe(failureFacts(cause), codeIssuedAt));

  const failedWith = (facts: FailureFacts) =>
    Effect.promise(() => describe(facts)).pipe(Effect.map(failed));

  const lastOrganization = () => options.vault.loadLastOrganization().catch(() => null);

  const persist = (account: Account) =>
    Effect.promise(async () => {
      const current = tokens.get();
      if (current === null) return;
      await options.vault.save({ version: 1, tokens: current, account }).catch(() => undefined);
    }).pipe(Effect.uninterruptible);

  const inSession = <A extends ActionResult | RefreshedTokenSet | null, E extends AuthClientError>(
    work: Effect.Effect<A, E>,
    whenInterrupted: A,
  ) =>
    Effect.runPromise(
      FiberSet.run(sessionWork, work).pipe(
        Effect.flatMap(Fiber.await),
        Effect.flatMap((exit) =>
          Exit.hasInterrupts(exit) ? Effect.succeed(whenInterrupted) : exit,
        ),
      ),
    );

  const leaveSession = (event: AuthEvent) =>
    Effect.gen(function* () {
      tokens.set(null);
      setFlow(null);
      dispatch(event);
      yield* FiberSet.clear(sessionWork);
      yield* Effect.promise(() => options.vault.clear().catch(() => undefined));
    });

  const endSession = Effect.forkDetach(leaveSession({ _tag: "SessionEnded" }), {
    startImmediately: true,
  });

  const adoptAccount = Effect.fn("MobileAuth.adoptAccount")(function* (account: Account) {
    yield* persist(account);
    const remembered = yield* Effect.promise(lastOrganization);
    dispatch({ _tag: "AccountRefreshed", account, lastOrganization: remembered });
  });

  const refreshTokens = Effect.fn("MobileAuth.refreshTokens")(function* () {
    const refreshToken = tokens.get()?.refreshToken;
    if (!refreshToken) return null;
    const result = yield* Effect.result(options.authClient.refresh({ refreshToken }));
    if (Result.isFailure(result)) {
      if (!rejectsRefresh(failureFacts(result.failure))) return yield* Effect.fail(result.failure);
      yield* endSession;
      return null;
    }
    const next = refreshedTokens(result.success);
    tokens.set(next);
    const workspace = yield* decodeRefreshedWorkspace(result.success.workspace).pipe(Effect.orDie);
    if (activeAccount() !== null) yield* adoptAccount(accountFromWorkspace(workspace));
    return Struct.assign(next, { workspace }) satisfies RefreshedTokenSet;
  });

  const loadAccount = async (): Promise<Account> => {
    const refreshed = await http.ensureFreshAccess();
    if (refreshed?.workspace !== undefined) return accountFromWorkspace(refreshed.workspace);
    const snapshot = decodeSnapshot(await http.apiRequest("/api/auth/session"));
    if (Option.isNone(snapshot)) {
      throw new RequestError({
        status: 502,
        code: "INVALID_SESSION",
        message: "The server sent an unexpected session.",
      });
    }
    if (snapshot.value.status !== "authenticated") {
      throw new RequestError({
        status: 401,
        code: "UNAUTHENTICATED",
        message: "Sign in to continue.",
      });
    }
    return accountFromWorkspace(snapshot.value);
  };

  const fetchAccount = Effect.tryPromise({ try: loadAccount, catch: failureFacts });

  const refreshAccount = Effect.fn("MobileAuth.refreshAccount")(function* () {
    const loaded = yield* Effect.result(fetchAccount);
    if (Result.isFailure(loaded)) {
      if (endsSession(loaded.failure)) yield* endSession;
      return yield* failedWith(loaded.failure);
    }
    if (getState()._tag !== "Active") return done;
    yield* adoptAccount(loaded.success);
    return done;
  });

  const reloadAccount = () => inSession(refreshAccount(), sessionEnded);

  const http: SessionHttpClient = new SessionHttpClient({
    apiBaseUrl: options.apiBaseUrl,
    authBaseUrl: options.authBaseUrl,
    tokens,
    fetch: options.fetch,
    needsRefresh: refreshTokenNeedsRefresh,
    refreshSession: () => inSession(refreshTokens(), null),
  });

  const authRequest = (pathname: string, init?: JsonRequestInit) =>
    http.authRequest(pathname, init);

  const signInWith = Effect.fn("MobileAuth.signInWith")(function* (issued: TokenSet) {
    const loaded = yield* Effect.result(fetchAccount);
    if (Result.isFailure(loaded)) {
      tokens.set(null);
      if (issued.refreshToken) {
        yield* Effect.forkDetach(
          Effect.ignore(options.authClient.signOut({ refreshToken: issued.refreshToken })),
        );
      }
      return yield* failedWith(loaded.failure);
    }
    yield* persist(loaded.success);
    const remembered = yield* Effect.promise(lastOrganization);
    setFlow(null);
    dispatch({ _tag: "SignedIn", account: loaded.success, lastOrganization: remembered });
    return done;
  });

  const adopt = async (issued: TokenSet): Promise<ActionResult> => {
    await Effect.runPromise(FiberSet.clear(sessionWork));
    tokens.set(issued);
    return inSession(signInWith(issued), done);
  };

  const identify = async (email: string): Promise<IdentifyResult> => {
    const address = Schema.decodeUnknownOption(EmailAddress)(normalizeEmail(email));
    if (Option.isNone(address)) return failed(invalid("Enter a valid email address.", "email"));
    const result = await run(options.authClient.identify({ email: address.value }));
    if (Result.isFailure(result)) return failure(result.failure);
    setFlow({ route: result.success, issuedAt: now() });
    return { _tag: "Routed", route: result.success._tag };
  };

  const resendCode = async (): Promise<ActionResult> => {
    const route = getFlow()?.route;
    if (route?._tag !== "Otp") return startAgain();
    const result = await identify(route.email);
    return result._tag === "Failed" ? result : done;
  };

  const verifyCode = async (code: string): Promise<ActionResult> => {
    const flow = getFlow();
    const route = flow?.route;
    if (flow === null || route?._tag !== "Otp") return startAgain();
    const otp = Schema.decodeUnknownOption(OtpCode)(code.trim());
    if (Option.isNone(otp)) return failed(invalid("Enter the 6-digit code.", "code"));
    const result = await run(
      options.authClient.authenticate({
        _tag: "Otp",
        challengeId: route.challengeId,
        code: otp.value,
        client: options.client,
      }),
    );
    if (Result.isFailure(result)) return failure(result.failure, flow.issuedAt);
    return adopt(result.success);
  };

  const signInWithPassword = async (password: string): Promise<ActionResult> => {
    const route = getFlow()?.route;
    if (route?._tag !== "Password") return startAgain();
    if (password.length === 0) return failed(invalid("Enter your password.", "password"));
    const decoded = Schema.decodeUnknownOption(Password)(password);
    if (Option.isNone(decoded)) {
      return failed({
        kind: "wrongPassword",
        message: "That password isn't right.",
        field: "password",
      });
    }
    const result = await run(
      options.authClient.authenticate({
        _tag: "Password",
        email: route.email,
        password: decoded.value,
        client: options.client,
      }),
    );
    if (Result.isFailure(result)) return failure(result.failure);
    return adopt(result.success);
  };

  const createAccount = async (input: {
    readonly name: string;
    readonly password: string;
  }): Promise<ActionResult> => {
    const route = getFlow()?.route;
    if (route?._tag !== "Registration") return startAgain();
    const name = input.name.trim();
    if (name.length === 0 || name.length > 100) {
      return failed(invalid("Enter your name.", "name"));
    }
    const password = Schema.decodeUnknownOption(Password)(input.password);
    if (Option.isNone(password)) {
      return failed(
        invalid("Use 10 to 100 characters, with no spaces at the start or end.", "password"),
      );
    }
    const result = await run(
      options.authClient.authenticate({
        _tag: "RegisterPassword",
        email: route.email,
        name,
        password: password.value,
        client: options.client,
      }),
    );
    if (Result.isFailure(result)) return failure(result.failure);
    return adopt(result.success);
  };

  const signInWithGoogle = async (): Promise<GoogleSignInResult> => {
    const google = options.google;
    if (google === null) {
      return failed(problem("unavailable", "Google sign-in isn't set up in this build."));
    }
    const identity = await google.requestIdToken();
    if (identity._tag === "Cancelled") return identity;
    if (identity._tag === "Failed") return failed(problem("rejected", identity.message));
    const idToken = Schema.decodeUnknownOption(GoogleIdToken)(identity.idToken);
    if (Option.isNone(idToken)) {
      return failed(problem("rejected", "Google sign-in didn't finish. Try again."));
    }
    const result = await run(
      options.authClient.exchangeGoogleIdToken({ idToken: idToken.value, client: options.client }),
    );
    if (Result.isFailure(result)) return failure(result.failure);
    return adopt(result.success);
  };

  const confirm = async (account: Account, organizationId: string) => {
    await options.vault
      .saveLastOrganization({ userId: account.userId, organizationId })
      .catch(() => undefined);
    dispatch({ _tag: "OrganizationConfirmed", organizationId });
  };

  const rename = async (
    organization: NonNullable<Account["organization"]>,
    desired: string,
  ): Promise<ActionResult> => {
    const name = Schema.decodeUnknownOption(OrganizationName)(desired);
    if (Option.isNone(name)) {
      return failed(invalid("Use 2 to 60 characters for the store name.", "organizationName"));
    }
    const organizationId = Schema.decodeUnknownOption(OrganizationId)(organization.id);
    if (Option.isNone(organizationId))
      return failed(problem("rejected", "This store can't be renamed."));
    const slug = Schema.decodeUnknownOption(OrganizationSlug)(organization.slug);
    try {
      await organizeOrganization(authRequest, {
        _tag: "UpdateOrganization",
        organizationId: organizationId.value,
        name: name.value,
        slug: Option.getOrNull(slug),
      });
      return (await http.ensureFreshAccess(true)) === null ? sessionEnded : done;
    } catch (cause) {
      return failure(cause);
    }
  };

  const confirmOrganization = async (input: { readonly name?: string }): Promise<ActionResult> => {
    const account = activeAccount();
    const organization = account?.organization ?? null;
    if (account === null || organization === null) {
      return failed(invalid("Join a store to continue.", "invitation"));
    }
    const desired = input.name?.trim();
    if (desired !== undefined && desired !== organization.name && canRename(organization.role)) {
      const renamed = await rename(organization, desired);
      if (renamed._tag === "Failed") return renamed;
    }
    await confirm(account, organization.id);
    return done;
  };

  const joinOrganization = async (invitation: string): Promise<ActionResult> => {
    const token = Schema.decodeUnknownOption(InvitationToken)(invitation.trim());
    if (Option.isNone(token)) {
      return failed(invalid("Paste the invitation code you were sent.", "invitation"));
    }
    try {
      const result = await organizeOrganization(authRequest, {
        _tag: "AcceptInvitation",
        token: token.value,
      });
      if (result._tag !== "Joined") {
        return failed(problem("rejected", "The invitation could not be used."));
      }
      if ((await http.ensureFreshAccess(true)) === null) return sessionEnded;
      const account = activeAccount();
      if (account?.organization?.id !== result.organization.id) {
        return failed(problem("unavailable", "You joined the store. Try again in a moment."));
      }
      await confirm(account, result.organization.id);
      return done;
    } catch (cause) {
      return failure(cause);
    }
  };

  const signOut = async () => {
    await http.awaitRefreshInFlight()?.catch(() => null);
    const refreshToken = tokens.get()?.refreshToken;
    await Effect.runPromise(leaveSession({ _tag: "SignedOut" }));
    await options.google?.forget().catch(() => undefined);
    if (refreshToken) void run(options.authClient.signOut({ refreshToken }));
  };

  const restore = async () => {
    const [stored, remembered] = await Promise.all([
      options.vault.load().catch(() => null),
      lastOrganization(),
    ]);
    if (stored !== null) tokens.set(stored.tokens);
    dispatch({ _tag: "Restored", account: stored?.account ?? null, lastOrganization: remembered });
    if (stored !== null) void reloadAccount();
  };

  const start = () => {
    if (started === null) started = restore();
    return started;
  };

  return {
    getState,
    subscribe: (listener) => registry.subscribe(stateAtom, listener),
    getFlow,
    subscribeFlow: (listener) => registry.subscribe(flowAtom, listener),
    start,
    googleAvailable: options.google !== null,
    identify,
    resendCode,
    verifyCode,
    signInWithPassword,
    createAccount,
    signInWithGoogle,
    confirmOrganization,
    joinOrganization,
    signOut,
    authenticatedFetch: makeAuthenticatedFetch(http),
    liveAccessToken: async ({ force }) =>
      (await http.ensureFreshAccess(force))?.accessToken ?? null,
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
