import {
  unauthenticatedWorkspace,
  withWorkspaceError,
  withWorkspaceOnline,
  WorkspaceSnapshot,
} from "@store/contracts";
import type { JsonRequestInit, WorkspaceAuthAdapter } from "@store/workspace";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

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

const navigatorOnline = () => globalThis.navigator?.onLine ?? true;

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
      return this.#publish(
        withWorkspaceOnline(this.#snapshot, this.#snapshot.status === "authenticated"),
      );
    }
    try {
      const snapshot = Schema.decodeUnknownSync(WorkspaceSnapshot)(
        await this.apiRequest("/api/auth/session"),
      );
      if (snapshot.status !== "authenticated")
        return this.#publish(
          unauthenticated(
            true,
            "Your sign-in completed, but the server could not validate the session.",
          ),
        );
      return this.#publish(withWorkspaceOnline(snapshot, true));
    } catch (error) {
      if (error instanceof RequestError && (error.status === 401 || error.status === 403))
        return this.#publish(unauthenticated(true, error.message));
      return this.#publish(
        withWorkspaceError(
          withWorkspaceOnline(this.#snapshot, false),
          error instanceof Error ? error.message : "The session server could not be reached.",
        ),
      );
    }
  }

  async signOut() {
    this.#token = null;
    this.#publish(unauthenticated(navigatorOnline()));
  }

  async apiRequest(pathname: string, init?: JsonRequestInit) {
    const headers = new Headers(init?.headers);
    if (this.#token) headers.set("authorization", `Bearer ${this.#token}`);
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
    const response = await fetch(`${this.#baseUrl}${pathname}`, {
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
}
