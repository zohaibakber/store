import type {
  OrganizationCommand,
  OrganizationCommandResult,
  OrganizationRoster,
  TokenSet,
} from "@store/auth";
import { unauthenticatedWorkspace, type WorkspaceSnapshot } from "@store/contracts/workspace";
import {
  MemoryTokenStore,
  SessionHttp,
  adoptAuthenticatedSnapshot,
  adoptSessionTokens,
  layerSessionHttp,
  renewSessionSnapshot,
  sessionFetch,
  type SessionHttpApi,
  type SessionSnapshotHooks,
  type WorkspaceAuthAdapter,
} from "@store/workspace";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { analyseInvoiceUpload, type InvoiceUploadFile } from "@/lib/invoice-upload";

const SESSION_EXPECTED_KEY = "tabaaq-web-session-expected";

export type SessionHintStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type WebAuthBrokerOptions = {
  readonly apiBaseUrl: string;
  readonly authBaseUrl: string;
  readonly fetch?: typeof fetch;
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

const failureMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Could not refresh the session.";

export class WebAuthBroker implements WorkspaceAuthAdapter {
  readonly #tokens = new MemoryTokenStore();
  readonly #hint: ReturnType<typeof signedInOriginHint>;
  readonly #isOnline: () => boolean;
  readonly #hooks: SessionSnapshotHooks;
  readonly #runtime: ManagedRuntime.ManagedRuntime<SessionHttp, never>;
  readonly apiFetch: typeof fetch;
  #snapshot: WorkspaceSnapshot = unauthenticatedWorkspace({ isOnline: false });

  constructor(
    options: WebAuthBrokerOptions,
    publishSession: (snapshot: WorkspaceSnapshot) => void,
  ) {
    const send: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#hint = signedInOriginHint(options.storage ?? browserStorage);
    this.#isOnline = options.isOnline ?? (() => globalThis.navigator?.onLine ?? true);
    const forget = Effect.sync(() => {
      this.#hint.clear();
      this.#hooks.publish(this.#signedOut());
    });
    this.#hooks = {
      getLocalSnapshot: () => this.#snapshot,
      publish: (snapshot) => {
        this.#snapshot = snapshot;
        publishSession(snapshot);
        return snapshot;
      },
      clearAuthenticated: forget,
    };
    this.#runtime = ManagedRuntime.make(
      layerSessionHttp({
        apiBaseUrl: options.apiBaseUrl,
        authBaseUrl: options.authBaseUrl,
        tokens: this.#tokens,
        credential: "cookie",
        onRefreshed: (refreshed) =>
          Effect.sync(() => this.#hint.mark()).pipe(
            Effect.andThen(adoptAuthenticatedSnapshot(this.#hooks, refreshed.workspace)),
            Effect.asVoid,
          ),
        onRejected: forget,
      }).pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch, send)),
      ),
    );
    this.apiFetch = sessionFetch((effect, runOptions) =>
      this.#runtime.runPromise(effect, runOptions),
    );
  }

  get snapshot() {
    return this.#snapshot;
  }

  #use<A, E>(f: (session: SessionHttpApi) => Effect.Effect<A, E, SessionHttp>) {
    return this.#runtime.runPromise(SessionHttp.use(f));
  }

  async initialize(): Promise<WorkspaceSnapshot> {
    if (!this.#hint.expected()) return this.#hooks.publish(this.#signedOut());
    try {
      await this.#use((session) => session.ensureFreshAccess(true));
      return this.#snapshot;
    } catch (cause) {
      return this.#hooks.publish(this.#signedOut(failureMessage(cause)));
    }
  }

  adoptSession(tokens: TokenSet | null) {
    if (tokens) this.#hint.mark();
    else this.#hint.clear();
    return this.#runtime.runPromise(
      adoptSessionTokens(this.#hooks, tokens, { onCleared: this.#hooks.clearAuthenticated }),
    );
  }

  renewSession() {
    return this.#runtime.runPromise(renewSessionSnapshot(this.#hooks));
  }

  signOut() {
    const hooks = this.#hooks;
    return this.#use((session) =>
      Effect.gen(function* () {
        yield* session.settled;
        yield* session.setTokens(null);
        if (hooks.clearAuthenticated !== undefined) yield* hooks.clearAuthenticated;
        yield* session.logout(null).pipe(Effect.ignore);
      }),
    );
  }

  async liveAccessToken(force: boolean) {
    const access = await this.#use((session) => session.ensureFreshAccess(force));
    return access?.accessToken ?? null;
  }

  organizationRoster(): Promise<OrganizationRoster> {
    return this.#use((session) => session.organizationRoster);
  }

  organize(command: OrganizationCommand): Promise<OrganizationCommandResult> {
    return this.#use((session) => session.organize(command));
  }

  analyseInvoices(files: ReadonlyArray<InvoiceUploadFile>) {
    return this.#runtime.runPromise(analyseInvoiceUpload(files));
  }

  #signedOut(workspaceError: string | null = null) {
    return unauthenticatedWorkspace({ isOnline: this.#isOnline(), workspaceError });
  }
}
