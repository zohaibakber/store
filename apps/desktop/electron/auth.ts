import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { RefreshInput, SignOutInput, TokenSet, type TokenSet as TokenSetType } from "@store/auth";
import { unauthenticatedWorkspace, withWorkspaceOnline, WorkspaceSnapshot } from "@store/contracts";
import {
  MemoryTokenStore,
  RequestError,
  SessionHttpClient,
  adoptSessionTokens,
  decodeTokenSet,
  loadSessionSnapshot,
  refreshTokenNeedsRefresh,
  renewSessionSnapshot,
  type JsonRequestInit,
  type SessionSnapshotHooks,
  type WorkspaceAuthAdapter,
} from "@store/workspace";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { app, net, safeStorage } from "electron";

const PersistedAuth = Schema.Struct({ snapshot: WorkspaceSnapshot, tokens: TokenSet });
type PersistedAuth = typeof PersistedAuth.Type;

const unauthenticated = (isOnline: boolean, workspaceError: string | null = null) =>
  unauthenticatedWorkspace({ isOnline, workspaceError });

export { RequestError };

export class AuthBroker implements WorkspaceAuthAdapter {
  readonly #http: SessionHttpClient;
  readonly #tokens: MemoryTokenStore;
  readonly #electronOrigin: string;
  readonly #hooks: SessionSnapshotHooks;
  #snapshot: WorkspaceSnapshot = unauthenticated(false);

  constructor(baseUrl: string, authBaseUrl: string, electronOrigin: string) {
    this.#tokens = new MemoryTokenStore();
    this.#electronOrigin = electronOrigin;
    this.#http = new SessionHttpClient({
      apiBaseUrl: baseUrl,
      authBaseUrl,
      tokens: this.#tokens,
      fetch: (url, init) => net.fetch(url, init),
      needsRefresh: refreshTokenNeedsRefresh,
      refreshSession: () => this.#rotateTokens(),
      requestHeaders: () => ({ "electron-origin": this.#electronOrigin }),
    });
    this.#hooks = {
      http: this.#http,
      getLocalSnapshot: () => this.#snapshot,
      publish: (snapshot) => {
        this.#snapshot = snapshot;
        return snapshot;
      },
      clearAuthenticated: () => this.#clear(),
      persistAuthenticated: async (snapshot) => {
        const tokens = this.#tokens.get();
        if (tokens) await this.#writePersisted({ snapshot, tokens });
      },
    };
  }

  get snapshot() {
    return this.#snapshot;
  }

  get accessToken() {
    return this.#tokens.get()?.accessToken ?? null;
  }

  async initialize() {
    const persisted = await this.#readPersisted();
    if (persisted) {
      this.#tokens.set(persisted.tokens);
      this.#snapshot = withWorkspaceOnline(persisted.snapshot, false);
      await this.#http.ensureFreshAccess().catch(() => undefined);
    }
    return this.#snapshot;
  }

  adoptSession(tokens: TokenSetType | null) {
    return adoptSessionTokens(this.#hooks, tokens, {
      onCleared: () => this.#clear(),
    });
  }

  renewSession() {
    return renewSessionSnapshot(this.#hooks);
  }

  refresh() {
    return loadSessionSnapshot(this.#hooks);
  }

  async signOut() {
    await this.#http.awaitRefreshInFlight()?.catch(() => undefined);
    const refreshToken = this.#tokens.get()?.refreshToken;
    this.#tokens.set(null);
    if (refreshToken) {
      await net
        .fetch(`${this.#http.authBaseUrl}/v1/session/logout`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(SignOutInput.make({ refreshToken })),
        })
        .catch(() => undefined);
    }
    this.#tokens.set(null);
    await this.#clear();
    this.#hooks.publish(unauthenticated(true));
  }

  apiRequest(pathname: string, init?: JsonRequestInit) {
    return this.#http.apiRequest(pathname, init);
  }

  authRequest(pathname: string, init?: JsonRequestInit) {
    return this.#http.authRequest(pathname, init);
  }

  async #clear() {
    this.#tokens.set(null);
    this.#snapshot = unauthenticated(true);
    await rm(this.#storagePath(), { force: true });
  }

  #storagePath() {
    return path.join(app.getPath("userData"), "auth", "session.bin");
  }

  async #readPersisted(): Promise<PersistedAuth | null> {
    try {
      const encrypted = await readFile(this.#storagePath());
      if (!safeStorage.isEncryptionAvailable()) return null;
      return Schema.decodeUnknownOption(PersistedAuth)(
        JSON.parse(safeStorage.decryptString(encrypted)),
      ).pipe(Option.getOrNull);
    } catch {
      return null;
    }
  }

  async #writePersisted(value: PersistedAuth) {
    if (!safeStorage.isEncryptionAvailable()) {
      if (!app.isPackaged) {
        await rm(this.#storagePath(), { force: true });
        return;
      }
      throw new Error("This system can't store credentials securely.");
    }
    await mkdir(path.dirname(this.#storagePath()), { recursive: true });
    await writeFile(this.#storagePath(), safeStorage.encryptString(JSON.stringify(value)), {
      mode: 0o600,
    });
  }

  /** Returns null on expected refresh failure — never throws for non-OK HTTP. */
  async #rotateTokens(): Promise<TokenSetType | null> {
    const tokens = this.#tokens.get();
    if (!tokens?.refreshToken) return null;
    const response = await net.fetch(`${this.#http.authBaseUrl}/v1/session/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(RefreshInput.make({ refreshToken: tokens.refreshToken })),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) await this.#clear();
      return null;
    }
    const next = decodeTokenSet(await response.json());
    this.#tokens.set(next);
    await this.#writePersisted({ snapshot: this.#snapshot, tokens: next });
    return next;
  }
}
