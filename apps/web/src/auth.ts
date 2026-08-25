import type { TokenSet as TokenSetType } from "@store/auth";
import { unauthenticatedWorkspace, type WorkspaceSnapshot } from "@store/contracts/workspace";
import {
  adoptSessionTokens,
  loadSessionSnapshot,
  renewSessionSnapshot,
  type SessionSnapshotHooks,
} from "@store/workspace/session-broker";
import {
  MemoryTokenStore,
  RequestError,
  SessionHttpClient,
  cookieSessionNeedsRefresh,
  decodeTokenSet,
  requestErrorFromPayload,
} from "@store/workspace/session-http";
import type { JsonRequestInit, WorkspaceAuthAdapter } from "@store/workspace/workspace";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export { RequestError };

const SESSION_EXPECTED_KEY = "tabaaq-web-session-expected";

const unauthenticated = (isOnline: boolean, workspaceError: string | null = null) =>
  unauthenticatedWorkspace({ isOnline, workspaceError });

const navigatorOnline = () => globalThis.navigator?.onLine ?? true;

const hasExpectedSession = () => {
  try {
    return globalThis.localStorage?.getItem(SESSION_EXPECTED_KEY) === "1";
  } catch {
    return false;
  }
};

const markSessionExpected = () => {
  try {
    globalThis.localStorage?.setItem(SESSION_EXPECTED_KEY, "1");
  } catch {
    /* private mode / blocked storage */
  }
};

const clearSessionExpected = () => {
  try {
    globalThis.localStorage?.removeItem(SESSION_EXPECTED_KEY);
  } catch {
    /* private mode / blocked storage */
  }
};

export class WebAuthBroker implements WorkspaceAuthAdapter {
  readonly #http: SessionHttpClient;
  readonly #tokens: MemoryTokenStore;
  readonly #hooks: SessionSnapshotHooks;
  #snapshot: WorkspaceSnapshot = unauthenticated(false);

  constructor(baseUrl: string, authBaseUrl: string) {
    this.#tokens = new MemoryTokenStore();
    this.#http = new SessionHttpClient({
      apiBaseUrl: baseUrl,
      authBaseUrl,
      tokens: this.#tokens,
      fetch: (url, init) => fetch(url, init),
      needsRefresh: cookieSessionNeedsRefresh,
      refreshSession: () => this.#refreshViaCookie(),
      afterRefresh: async () => {
        await loadSessionSnapshot(this.#hooks);
      },
    });
    this.#hooks = {
      http: this.#http,
      getLocalSnapshot: () => this.#snapshot,
      publish: (snapshot) => {
        this.#snapshot = snapshot;
        return snapshot;
      },
    };
  }

  get snapshot() {
    return this.#snapshot;
  }

  get accessToken() {
    return this.#tokens.get()?.accessToken ?? null;
  }

  /** Refresh near-expiry access (live sync reconnect). */
  ensureFreshAccess(force = false) {
    return this.#http.ensureFreshAccess(force);
  }

  async initialize() {
    // Unsigned cold start: no prior sign-in on this origin → skip forced cookie refresh.
    // HttpOnly refresh cookies are invisible to JS; localStorage is the session expectation.
    if (!hasExpectedSession()) {
      return this.#hooks.publish(unauthenticated(navigatorOnline()));
    }
    try {
      const tokens = await this.#http.ensureFreshAccess(true);
      if (tokens) {
        markSessionExpected();
        return loadSessionSnapshot(this.#hooks);
      }
    } catch (cause) {
      return this.#hooks.publish(
        unauthenticated(
          navigatorOnline(),
          cause instanceof Error ? cause.message : "Could not refresh the session.",
        ),
      );
    }
    clearSessionExpected();
    return this.#hooks.publish(unauthenticated(navigatorOnline()));
  }

  adoptSession(tokens: TokenSetType | null) {
    if (tokens) markSessionExpected();
    else clearSessionExpected();
    return adoptSessionTokens(this.#hooks, tokens);
  }

  renewSession() {
    return renewSessionSnapshot(this.#hooks);
  }

  refresh() {
    return loadSessionSnapshot(this.#hooks);
  }

  async signOut() {
    await this.#http.awaitRefreshInFlight()?.catch(() => null);
    this.#tokens.set(null);
    clearSessionExpected();
    await fetch(`${this.#http.authBaseUrl}/v1/session/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: "{}",
    }).catch(() => undefined);
    this.#hooks.publish(unauthenticated(navigatorOnline()));
  }

  apiRequest(pathname: string, init?: JsonRequestInit) {
    return this.#http.apiRequest(pathname, init);
  }

  apiFetch(input: RequestInfo | URL, init?: RequestInit) {
    return this.#http.apiFetch(input, init);
  }

  authRequest(pathname: string, init?: JsonRequestInit) {
    return this.#http.authRequest(pathname, init);
  }

  async #refreshViaCookie(): Promise<TokenSetType | null> {
    const response = await fetch(`${this.#http.authBaseUrl}/v1/session/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: "{}",
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        this.#tokens.set(null);
        clearSessionExpected();
        return null;
      }
      const payload = await response
        .json()
        .then(Schema.decodeUnknownOption(Schema.Json))
        .then(Option.getOrNull)
        .catch(() => null);
      throw requestErrorFromPayload(payload, response.status);
    }
    const next = decodeTokenSet(await response.json());
    this.#tokens.set(next);
    markSessionExpected();
    return next;
  }
}
