import { type WorkspaceSnapshot } from "@store/contracts";
import type { JsonRequestInit, WorkspaceAuthAdapter } from "@store/workspace";

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

const navigatorOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine);

export class WebAuthBroker implements WorkspaceAuthAdapter {
  readonly #baseUrl: string;
  readonly #listeners = new Set<(snapshot: WorkspaceSnapshot) => void>();
  #snapshot: WorkspaceSnapshot = unauthenticated(false);
  #token: string | null = null;

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl.replace(/\/api\/?$/, "").replace(/\/$/, "");
  }

  get snapshot() {
    return this.#snapshot;
  }

  onChange(listener: (snapshot: WorkspaceSnapshot) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async initialize() {
    return this.#snapshot;
  }

  async adoptSession(token: string | null) {
    this.#token = token;
    if (!token) return this.#publish(unauthenticated(true));
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
      const snapshot = await this.apiRequest<WorkspaceSnapshot>("/api/auth/session");
      if (!snapshot || snapshot.status !== "authenticated" || !snapshot.user)
        return this.#publish(unauthenticated(true));
      return this.#publish({ ...snapshot, isOnline: true });
    } catch (error) {
      if (error instanceof RequestError && (error.status === 401 || error.status === 403))
        return this.#publish(unauthenticated(true));
      return this.#publish({ ...this.#snapshot, isOnline: false });
    }
  }

  async signOut() {
    this.#token = null;
    this.#publish(unauthenticated(navigatorOnline()));
  }

  async apiRequest<T>(pathname: string, init?: JsonRequestInit) {
    const headers = new Headers(init?.headers);
    if (this.#token) headers.set("authorization", `Bearer ${this.#token}`);
    let body = init?.body as BodyInit | null | undefined;
    if (body && !(body instanceof FormData) && typeof body !== "string") {
      headers.set("content-type", "application/json");
      body = JSON.stringify(body);
    }
    const response = await fetch(`${this.#baseUrl}${pathname}`, {
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
}
