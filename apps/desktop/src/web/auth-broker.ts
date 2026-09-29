import { RefreshInput, SignOutInput, type TokenSet } from "@store/auth";
import { unauthenticatedWorkspace, type WorkspaceSnapshot } from "@store/contracts/workspace";
import {
  MemoryTokenStore,
  RefreshedTokenSet,
  SessionHttpClient,
  adoptAuthenticatedSnapshot,
  adoptSessionTokens,
  cookieSessionNeedsRefresh,
  refreshedTokens,
  renewSessionSnapshot,
  requestErrorFromPayload,
  type JsonRequestInit,
  type SessionFetch,
  type SessionSnapshotHooks,
  type WorkspaceAuthAdapter,
} from "@store/workspace";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const SESSION_EXPECTED_KEY = "tabaaq-web-session-expected";

export type SessionHintStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type WebAuthBrokerOptions = {
  readonly apiBaseUrl: string;
  readonly authBaseUrl: string;
  readonly fetch?: SessionFetch;
  readonly storage?: SessionHintStore;
  readonly isOnline?: () => boolean;
};

const browserStorage: SessionHintStore = {
  getItem: (key) => globalThis.localStorage.getItem(key),
  setItem: (key, value) => globalThis.localStorage.setItem(key, value),
  removeItem: (key) => globalThis.localStorage.removeItem(key),
};

const signedInOriginHint = (store: SessionHintStore) => ({
  expected: () => {
    try {
      return store.getItem(SESSION_EXPECTED_KEY) === "1";
    } catch {
      return false;
    }
  },
  mark: () => {
    try {
      store.setItem(SESSION_EXPECTED_KEY, "1");
    } catch {
      return;
    }
  },
  clear: () => {
    try {
      store.removeItem(SESSION_EXPECTED_KEY);
    } catch {
      return;
    }
  },
});

const encodeRefresh = Schema.encodeSync(Schema.fromJsonString(RefreshInput));
const encodeSignOut = Schema.encodeSync(Schema.fromJsonString(SignOutInput));
const decodeRefreshed = Schema.decodeUnknownSync(Schema.fromJsonString(RefreshedTokenSet));
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

const failureMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Could not refresh the session.";

const isExplicitAuthRejection = (status: number) => status === 401 || status === 403;

export class WebAuthBroker implements WorkspaceAuthAdapter {
  readonly #http: SessionHttpClient;
  readonly #tokens = new MemoryTokenStore();
  readonly #fetch: SessionFetch;
  readonly #hint: ReturnType<typeof signedInOriginHint>;
  readonly #isOnline: () => boolean;
  readonly #hooks: SessionSnapshotHooks;
  #snapshot: WorkspaceSnapshot = unauthenticatedWorkspace({ isOnline: false });

  constructor(options: WebAuthBrokerOptions) {
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#hint = signedInOriginHint(options.storage ?? browserStorage);
    this.#isOnline = options.isOnline ?? (() => globalThis.navigator?.onLine ?? true);
    this.#http = new SessionHttpClient({
      apiBaseUrl: options.apiBaseUrl,
      authBaseUrl: options.authBaseUrl,
      tokens: this.#tokens,
      fetch: this.#fetch,
      needsRefresh: cookieSessionNeedsRefresh,
      refreshSession: () => this.#refreshWithCookie(),
    });
    this.#hooks = {
      http: this.#http,
      getLocalSnapshot: () => this.#snapshot,
      publish: (snapshot) => {
        this.#snapshot = snapshot;
        return snapshot;
      },
      clearAuthenticated: async () => this.#clear(),
    };
  }

  get snapshot() {
    return this.#snapshot;
  }

  async initialize(): Promise<WorkspaceSnapshot> {
    if (!this.#hint.expected()) return this.#hooks.publish(this.#signedOut());
    try {
      const refreshed = await this.#http.ensureFreshAccess(true);
      if (refreshed) return this.#snapshot;
    } catch (cause) {
      return this.#hooks.publish(this.#signedOut(failureMessage(cause)));
    }
    return this.#hooks.publish(this.#signedOut());
  }

  adoptSession(tokens: TokenSet | null) {
    if (tokens) this.#hint.mark();
    else this.#hint.clear();
    return adoptSessionTokens(this.#hooks, tokens, { onCleared: async () => this.#clear() });
  }

  renewSession() {
    return renewSessionSnapshot(this.#hooks);
  }

  async signOut() {
    await this.#http.awaitRefreshInFlight()?.catch(() => null);
    this.#clear();
    await this.#fetch(`${this.#http.authBaseUrl}/v1/session/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: encodeSignOut(SignOutInput.make({})),
    }).catch(() => undefined);
    this.#hooks.publish(this.#signedOut());
  }

  apiRequest(pathname: string, init?: JsonRequestInit) {
    return this.#http.apiRequest(pathname, init);
  }

  apiFetch(input: RequestInfo | URL, init?: RequestInit) {
    return this.#http.apiFetch(input, init);
  }

  async liveAccessToken(force: boolean) {
    return (await this.#http.ensureFreshAccess(force))?.accessToken ?? null;
  }

  authRequest(pathname: string, init?: JsonRequestInit) {
    return this.#http.authRequest(pathname, init);
  }

  #signedOut(workspaceError: string | null = null) {
    return unauthenticatedWorkspace({ isOnline: this.#isOnline(), workspaceError });
  }

  #clear() {
    this.#tokens.set(null);
    this.#hint.clear();
    this.#snapshot = this.#signedOut();
  }

  async #refreshWithCookie(): Promise<RefreshedTokenSet | null> {
    const response = await this.#fetch(`${this.#http.authBaseUrl}/v1/session/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: encodeRefresh(RefreshInput.make({})),
    });
    const bodyText = await response.text();
    if (!response.ok) {
      if (isExplicitAuthRejection(response.status)) {
        this.#clear();
        return null;
      }
      throw requestErrorFromPayload(decodeJson(bodyText).pipe(Option.getOrNull), response.status);
    }
    const refreshed = decodeRefreshed(bodyText);
    this.#tokens.set(refreshedTokens(refreshed));
    this.#hint.mark();
    await adoptAuthenticatedSnapshot(this.#hooks, refreshed.workspace);
    return refreshed;
  }
}
