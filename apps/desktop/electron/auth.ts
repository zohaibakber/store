import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { type WorkspaceSnapshot } from "@store/contracts";
import type { JsonRequestInit, WorkspaceAuthAdapter } from "@store/workspace";
import { app, net, safeStorage } from "electron";

interface PersistedAuth {
  readonly snapshot: WorkspaceSnapshot;
}

export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

const unauthenticated = (isOnline: boolean): WorkspaceSnapshot => ({
  status: "unauthenticated",
  user: null,
  activeOrganization: null,
  organizations: [],
  isOnline,
});

export class AuthBroker implements WorkspaceAuthAdapter {
  readonly #baseUrl: string;
  readonly #electronOrigin: string;
  readonly #listeners = new Set<(snapshot: WorkspaceSnapshot) => void>();
  #snapshot: WorkspaceSnapshot = unauthenticated(false);
  #token: string | null = null;

  constructor(baseUrl: string, electronOrigin: string) {
    this.#baseUrl = baseUrl.replace(/\/api\/?$/, "").replace(/\/$/, "");
    this.#electronOrigin = electronOrigin;
  }

  get snapshot() {
    return this.#snapshot;
  }

  onChange(listener: (snapshot: WorkspaceSnapshot) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async initialize() {
    const persisted = await this.#readPersisted();
    if (persisted) {
      this.#snapshot = { ...persisted.snapshot, isOnline: false };
    }
    return this.#snapshot;
  }

  async adoptSession(token: string | null) {
    this.#token = token;
    if (!token) {
      await this.#clear();
      return this.#publish(unauthenticated(true));
    }
    return this.refresh();
  }

  async refresh() {
    if (!this.#token) {
      return this.#publish({
        ...this.#snapshot,
        isOnline: this.#snapshot.status === "authenticated",
      });
    }
    try {
      const snapshot = await this.#request<WorkspaceSnapshot>("/api/auth/session");
      if (!snapshot || snapshot.status !== "authenticated" || !snapshot.user) {
        await this.#clear();
        return this.#publish(unauthenticated(true));
      }
      return this.#persistAndPublish({ ...snapshot, isOnline: true });
    } catch (error) {
      if (error instanceof RequestError && (error.status === 401 || error.status === 403)) {
        await this.#clear();
        return this.#publish(unauthenticated(true));
      }
      return this.#publish({ ...this.#snapshot, isOnline: false });
    }
  }

  async signOut() {
    this.#token = null;
    await this.#clear();
    this.#publish(unauthenticated(true));
  }

  async apiRequest<T>(pathname: string, init?: JsonRequestInit) {
    return this.#request<T>(pathname, init);
  }

  async #request<T = unknown>(pathname: string, init?: JsonRequestInit) {
    const headers = new Headers(init?.headers);
    if (this.#token) headers.set("authorization", `Bearer ${this.#token}`);
    headers.set("electron-origin", this.#electronOrigin);
    let body = init?.body as BodyInit | null | undefined;
    if (body && !(body instanceof FormData) && typeof body !== "string") {
      headers.set("content-type", "application/json");
      body = JSON.stringify(body);
    }
    const response = await net.fetch(`${this.#baseUrl}${pathname}`, {
      ...init,
      body,
      credentials: "omit",
      headers,
    });
    const payload = (await response.json().catch(() => null)) as
      | (T & { message?: string; error?: string | { code?: string; message?: string } })
      | null;
    if (!response.ok) {
      const nested = payload?.error;
      const message =
        payload?.message ??
        (typeof nested === "string" ? nested : nested?.message) ??
        `Request failed (${response.status})`;
      throw new RequestError(
        message,
        response.status,
        typeof nested === "object" ? nested.code : undefined,
      );
    }
    return payload as T;
  }

  #publish(snapshot: WorkspaceSnapshot) {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener(snapshot);
    return snapshot;
  }

  async #persistAndPublish(snapshot: WorkspaceSnapshot) {
    this.#publish(snapshot);
    await this.#writePersisted({ snapshot });
    return snapshot;
  }

  async #clear() {
    this.#token = null;
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
      return JSON.parse(safeStorage.decryptString(encrypted)) as PersistedAuth;
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
}
