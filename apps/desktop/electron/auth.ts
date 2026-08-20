import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { unauthenticatedWorkspace, withWorkspaceOnline, WorkspaceSnapshot } from "@store/contracts";
import { RefreshInput, SignOutInput, TokenSet, type TokenSet as TokenSetType } from "@store/auth";
import type { JsonRequestInit, WorkspaceAuthAdapter } from "@store/workspace";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { app, net, safeStorage } from "electron";

const PersistedAuth = Schema.Struct({ snapshot: WorkspaceSnapshot, tokens: TokenSet });
type PersistedAuth = typeof PersistedAuth.Type;

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

export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

const unauthenticated = (isOnline: boolean, workspaceError: string | null = null) =>
  unauthenticatedWorkspace({ isOnline, workspaceError });

export class AuthBroker implements WorkspaceAuthAdapter {
  readonly #baseUrl: string;
  readonly #authBaseUrl: string;
  readonly #electronOrigin: string;
  readonly #listeners = new Set<(snapshot: WorkspaceSnapshot) => void>();
  #snapshot: WorkspaceSnapshot = unauthenticated(false);
  #tokens: TokenSetType | null = null;

  constructor(baseUrl: string, authBaseUrl: string, electronOrigin: string) {
    this.#baseUrl = baseUrl.replace(/\/api\/?$/, "").replace(/\/$/, "");
    this.#authBaseUrl = authBaseUrl.replace(/\/$/, "");
    this.#electronOrigin = electronOrigin;
  }

  get snapshot() {
    return this.#snapshot;
  }

  get accessToken() {
    return this.#tokens?.accessToken ?? null;
  }

  onChange(listener: (snapshot: WorkspaceSnapshot) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async initialize() {
    const persisted = await this.#readPersisted();
    if (persisted) {
      this.#tokens = persisted.tokens;
      this.#snapshot = withWorkspaceOnline(persisted.snapshot, false);
      await this.#refreshTokens().catch(() => undefined);
    }
    return this.#snapshot;
  }

  async adoptSession(tokens: TokenSetType | null) {
    this.#tokens = tokens;
    if (!tokens) {
      await this.#clear();
      return this.#publish(unauthenticated(true));
    }
    return this.refresh();
  }

  async refresh() {
    if (!this.#tokens) {
      return this.#publish(
        withWorkspaceOnline(this.#snapshot, this.#snapshot.status === "authenticated"),
      );
    }
    try {
      const snapshot = Schema.decodeUnknownSync(WorkspaceSnapshot)(
        await this.#request("/api/auth/session"),
      );
      if (snapshot.status !== "authenticated") {
        await this.#clear();
        return this.#publish(unauthenticated(true));
      }
      return this.#persistAndPublish(withWorkspaceOnline(snapshot, true));
    } catch (error) {
      if (error instanceof RequestError && (error.status === 401 || error.status === 403)) {
        await this.#clear();
        return this.#publish(unauthenticated(true, error.message));
      }
      return this.#publish(withWorkspaceOnline(this.#snapshot, false));
    }
  }

  async signOut() {
    const refreshToken = this.#tokens?.refreshToken;
    if (refreshToken) {
      await net
        .fetch(`${this.#authBaseUrl}/v1/session/logout`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(SignOutInput.make({ refreshToken })),
        })
        .catch(() => undefined);
    }
    this.#tokens = null;
    await this.#clear();
    this.#publish(unauthenticated(true));
  }

  async apiRequest(pathname: string, init?: JsonRequestInit) {
    return this.#request(pathname, init);
  }

  async #request(pathname: string, init?: JsonRequestInit) {
    await this.#refreshTokens();
    const headers = new Headers(init?.headers);
    if (this.#tokens) headers.set("authorization", `Bearer ${this.#tokens.accessToken}`);
    headers.set("electron-origin", this.#electronOrigin);
    const requestBody = init?.body;
    const body =
      requestBody === undefined || requestBody === null || requestBody instanceof FormData
        ? requestBody
        : Schema.is(Schema.String)(requestBody)
          ? requestBody
          : JSON.stringify(requestBody);
    if (body && !(body instanceof FormData) && !Schema.is(Schema.String)(requestBody)) {
      headers.set("content-type", "application/json");
    }
    const response = await net.fetch(`${this.#baseUrl}${pathname}`, {
      ...init,
      body,
      credentials: "omit",
      headers,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const failure = Schema.decodeUnknownOption(RequestFailure)(payload).pipe(Option.getOrNull);
      const nested = failure?.error;
      const message =
        failure?.message ??
        (Schema.is(Schema.String)(nested) ? nested : nested?.message) ??
        `Request failed (${response.status})`;
      throw new RequestError(
        message,
        response.status,
        nested !== undefined && !Schema.is(Schema.String)(nested) ? nested.code : undefined,
      );
    }
    return payload;
  }

  #publish(snapshot: WorkspaceSnapshot) {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener(snapshot);
    return snapshot;
  }

  async #persistAndPublish(snapshot: WorkspaceSnapshot) {
    this.#publish(snapshot);
    if (this.#tokens) await this.#writePersisted({ snapshot, tokens: this.#tokens });
    return snapshot;
  }

  async #clear() {
    this.#tokens = null;
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
      throw new Error("Secure credential storage is unavailable on this system.");
    }
    await mkdir(path.dirname(this.#storagePath()), { recursive: true });
    await writeFile(this.#storagePath(), safeStorage.encryptString(JSON.stringify(value)), {
      mode: 0o600,
    });
  }

  async #refreshTokens() {
    const tokens = this.#tokens;
    if (!tokens?.refreshToken || tokens.accessExpiresAt > Date.now() + 30_000) return;
    const response = await net.fetch(`${this.#authBaseUrl}/v1/session/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(RefreshInput.make({ refreshToken: tokens.refreshToken })),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) await this.#clear();
      throw new RequestError("The session could not be refreshed.", response.status);
    }
    this.#tokens = Schema.decodeUnknownSync(TokenSet)(await response.json());
  }
}
