import { app, safeStorage } from "electron";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface AuthUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly image?: string | null;
}

export interface AuthOrganization {
  readonly id: string;
  readonly name: string;
  readonly slug?: string | null;
  readonly role: string;
}

export interface AuthSnapshot {
  readonly status: "authenticated" | "unauthenticated";
  readonly user: AuthUser | null;
  readonly activeOrganization: AuthOrganization | null;
  readonly organizations: AuthOrganization[];
  readonly isOnline: boolean;
}

interface PersistedAuth {
  readonly token: string;
  readonly snapshot: AuthSnapshot;
}

type JsonRequestInit = Omit<RequestInit, "body"> & { body?: unknown };

class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const unauthenticated = (isOnline: boolean): AuthSnapshot => ({
  status: "unauthenticated",
  user: null,
  activeOrganization: null,
  organizations: [],
  isOnline,
});

const slugOf = (name: string) =>
  name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || `organization-${crypto.randomUUID().slice(0, 8)}`;

export class AuthBroker {
  readonly #baseUrl: string;
  readonly #electronOrigin: string;
  readonly #listeners = new Set<(snapshot: AuthSnapshot) => void>();
  #token = "";
  #snapshot: AuthSnapshot = unauthenticated(false);

  constructor(baseUrl: string, electronProtocol = "com.tabaaq.desktop") {
    this.#baseUrl = baseUrl.replace(/\/api\/?$/, "").replace(/\/$/, "");
    this.#electronOrigin = `${electronProtocol.replace(/:\/?$/, "")}:/`;
  }

  get snapshot() {
    return this.#snapshot;
  }

  get authorizationHeader() {
    return this.#token ? `Bearer ${this.#token}` : undefined;
  }

  onChange(listener: (snapshot: AuthSnapshot) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async initialize() {
    const persisted = await this.#readPersisted();
    if (persisted) {
      this.#token = persisted.token;
      this.#snapshot = { ...persisted.snapshot, isOnline: false };
    }
    return this.refresh();
  }

  async refresh() {
    if (!this.#token) return this.#publish(unauthenticated(navigatorOnline()));
    try {
      const session = await this.#request<{ user?: AuthUser | null }>("/api/auth/get-session");
      if (!session.user) {
        await this.#clear();
        return this.#publish(unauthenticated(true));
      }
      return this.#loadOrganizations(session.user);
    } catch (error) {
      if (error instanceof RequestError && (error.status === 401 || error.status === 403)) {
        await this.#clear();
        return this.#publish(unauthenticated(true));
      }
      return this.#publish({ ...this.#snapshot, isOnline: false });
    }
  }

  async signIn(input: { email: string; password: string }) {
    const response = await this.#requestWithResponse<{ user: AuthUser }>(
      "/api/auth/sign-in/email",
      { method: "POST", body: input },
      false,
    );
    this.#captureToken(response.response);
    if (!this.#token) throw new Error("The server did not return a desktop session token.");
    return this.#loadOrganizations(response.data.user);
  }

  async signUp(input: { name: string; email: string; password: string }) {
    const response = await this.#requestWithResponse<{ user: AuthUser }>(
      "/api/auth/sign-up/email",
      { method: "POST", body: { name: input.name, email: input.email, password: input.password } },
      false,
    );
    this.#captureToken(response.response);
    if (!this.#token) throw new Error("The server did not return a desktop session token.");
    return this.#loadOrganizations(response.data.user);
  }

  async signOut() {
    try {
      await this.#request("/api/auth/sign-out", { method: "POST" });
    } finally {
      await this.#clear();
      this.#publish(unauthenticated(navigatorOnline()));
    }
  }

  async switchOrganization(input: { organizationId: string }) {
    await this.#request("/api/auth/organization/set-active", {
      method: "POST",
      body: { organizationId: input.organizationId },
    });
    const selected = this.#snapshot.organizations.find((org) => org.id === input.organizationId);
    const member = await this.#request<{ role?: string }>(
      "/api/auth/organization/get-active-member",
    );
    const active = selected ? { ...selected, role: member.role ?? selected.role } : undefined;
    if (!active) throw new Error("That organization is not available to this account.");
    return this.#persistAndPublish({
      ...this.#snapshot,
      activeOrganization: active,
      isOnline: true,
    });
  }

  async createOrganization(input: { name: string }) {
    const created = await this.#request<{ id: string; name: string; slug?: string }>(
      "/api/auth/organization/create",
      {
        method: "POST",
        body: { name: input.name.trim(), slug: slugOf(input.name) },
      },
    );
    await this.#request("/api/auth/organization/set-active", {
      method: "POST",
      body: { organizationId: created.id },
    });
    const organization = { ...created, role: "owner" };
    return this.#persistAndPublish({
      ...this.#snapshot,
      activeOrganization: organization,
      organizations: [...this.#snapshot.organizations, organization],
      isOnline: true,
    });
  }

  async apiRequest<T>(pathname: string, init?: JsonRequestInit) {
    return this.#request<T>(pathname, init);
  }

  async #loadOrganizations(user: AuthUser) {
    const rows = await this.#request<Array<{ id: string; name: string; slug?: string }>>(
      "/api/auth/organization/list",
    );
    let organizations = rows.map((organization) => ({ ...organization, role: "member" }));
    const previousId = this.#snapshot.activeOrganization?.id;
    const activeOrganization =
      organizations.find((organization) => organization.id === previousId) ??
      organizations[0] ??
      null;
    if (activeOrganization && activeOrganization.id !== previousId) {
      await this.#request("/api/auth/organization/set-active", {
        method: "POST",
        body: { organizationId: activeOrganization.id },
      });
    }
    if (activeOrganization) {
      const member = await this.#request<{ role?: string }>(
        "/api/auth/organization/get-active-member",
      );
      if (member.role) {
        organizations = organizations.map((organization) =>
          organization.id === activeOrganization.id
            ? { ...organization, role: member.role! }
            : organization,
        );
      }
    }
    const resolvedActive =
      organizations.find((organization) => organization.id === activeOrganization?.id) ?? null;
    return this.#persistAndPublish({
      status: "authenticated",
      user,
      activeOrganization: resolvedActive,
      organizations,
      isOnline: true,
    });
  }

  async #request<T = unknown>(pathname: string, init?: JsonRequestInit) {
    return (await this.#requestWithResponse<T>(pathname, init)).data;
  }

  async #requestWithResponse<T>(
    pathname: string,
    init?: JsonRequestInit,
    includeAuthorization = true,
  ) {
    const headers = new Headers(init?.headers);
    headers.set("electron-origin", this.#electronOrigin);
    if (includeAuthorization && this.authorizationHeader)
      headers.set("authorization", this.authorizationHeader);
    let body = init?.body as BodyInit | null | undefined;
    if (body && !(body instanceof FormData) && typeof body !== "string") {
      headers.set("content-type", "application/json");
      body = JSON.stringify(body);
    }
    const response = await fetch(`${this.#baseUrl}${pathname}`, { ...init, headers, body });
    const payload = (await response.json().catch(() => null)) as
      | (T & { message?: string; error?: string | { message?: string } })
      | null;
    if (!response.ok) {
      const nested = payload?.error;
      const message =
        payload?.message ??
        (typeof nested === "string" ? nested : nested?.message) ??
        `Request failed (${response.status})`;
      throw new RequestError(message, response.status);
    }
    return { data: payload as T, response };
  }

  #captureToken(response: Response) {
    this.#token = response.headers.get("set-auth-token") ?? "";
  }

  #publish(snapshot: AuthSnapshot) {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener(snapshot);
    return snapshot;
  }

  async #persistAndPublish(snapshot: AuthSnapshot) {
    this.#publish(snapshot);
    await this.#writePersisted({ token: this.#token, snapshot });
    return snapshot;
  }

  async #clear() {
    this.#token = "";
    this.#snapshot = unauthenticated(navigatorOnline());
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

const navigatorOnline = () => true;
