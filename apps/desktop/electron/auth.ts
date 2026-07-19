import { makeElectronAuthClient, type ElectronAuthClient } from "@store/auth/electron-client";
import { app, net, safeStorage } from "electron";
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

const requestError = (error: { readonly message?: string; readonly status: number }) =>
  new RequestError(error.message ?? "Authentication request failed.", error.status);

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
  readonly #client: ElectronAuthClient;
  readonly #electronOrigin: string;
  readonly #listeners = new Set<(snapshot: AuthSnapshot) => void>();
  #snapshot: AuthSnapshot = unauthenticated(false);

  constructor(baseUrl: string, electronProtocol = "com.tabaaq.desktop") {
    this.#baseUrl = baseUrl.replace(/\/api\/?$/, "").replace(/\/$/, "");
    this.#electronOrigin = `${electronProtocol.replace(/:\/?$/, "")}:/`;
    this.#client = makeElectronAuthClient({
      baseURL: this.#baseUrl,
      protocol: electronProtocol.replace(/:\/?$/, ""),
    });
  }

  get snapshot() {
    return this.#snapshot;
  }

  setupMain() {
    this.#client.setupMain({ bridges: false, csp: false, scheme: false });
  }

  onChange(listener: (snapshot: AuthSnapshot) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async initialize() {
    const persisted = await this.#readPersisted();
    if (persisted) {
      this.#snapshot = { ...persisted.snapshot, isOnline: false };
    }
    return this.refresh();
  }

  async refresh() {
    try {
      const { data, error } = await this.#client.getSession();
      if (error) throw requestError(error);
      if (!data?.user) {
        await this.#clear();
        return this.#publish(unauthenticated(true));
      }
      return this.#loadOrganizations(data.user);
    } catch (error) {
      if (error instanceof RequestError && (error.status === 401 || error.status === 403)) {
        await this.#clear();
        return this.#publish(unauthenticated(true));
      }
      return this.#publish({ ...this.#snapshot, isOnline: false });
    }
  }

  async signIn(input: { email: string; password: string }) {
    const { data, error } = await this.#client.signIn.email(input);
    if (error) throw requestError(error);
    if (!data?.user) throw new Error("The server did not return an authenticated user.");
    return this.#loadOrganizations(data.user);
  }

  async signUp(input: { name: string; email: string; password: string }) {
    const { data, error } = await this.#client.signUp.email(input);
    if (error) throw requestError(error);
    if (!data?.user) throw new Error("The server did not return an authenticated user.");
    return this.#loadOrganizations(data.user);
  }

  async signOut() {
    try {
      const { error } = await this.#client.signOut();
      if (error) throw requestError(error);
    } finally {
      await this.#clear();
      this.#publish(unauthenticated(navigatorOnline()));
    }
  }

  async switchOrganization(input: { organizationId: string }) {
    const selectedResult = await this.#client.organization.setActive(input);
    if (selectedResult.error) throw requestError(selectedResult.error);
    const selected = this.#snapshot.organizations.find((org) => org.id === input.organizationId);
    const memberResult = await this.#client.organization.getActiveMember();
    if (memberResult.error) throw requestError(memberResult.error);
    const member = memberResult.data;
    const active = selected ? { ...selected, role: member.role ?? selected.role } : undefined;
    if (!active) throw new Error("That organization is not available to this account.");
    return this.#persistAndPublish({
      ...this.#snapshot,
      activeOrganization: active,
      isOnline: true,
    });
  }

  async createOrganization(input: { name: string }) {
    const createdResult = await this.#client.organization.create({
      name: input.name.trim(),
      slug: slugOf(input.name),
    });
    if (createdResult.error) throw requestError(createdResult.error);
    const created = createdResult.data;
    if (!created) throw new Error("The server did not return the created organization.");
    const selectedResult = await this.#client.organization.setActive({
      organizationId: created.id,
    });
    if (selectedResult.error) throw requestError(selectedResult.error);
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
    const listResult = await this.#client.organization.list();
    if (listResult.error) throw requestError(listResult.error);
    const rows = listResult.data ?? [];
    let organizations = rows.map((organization) => ({ ...organization, role: "member" }));
    const previousId = this.#snapshot.activeOrganization?.id;
    const activeOrganization =
      organizations.find((organization) => organization.id === previousId) ??
      organizations[0] ??
      null;
    if (activeOrganization && activeOrganization.id !== previousId) {
      const selectedResult = await this.#client.organization.setActive({
        organizationId: activeOrganization.id,
      });
      if (selectedResult.error) throw requestError(selectedResult.error);
    }
    if (activeOrganization) {
      const memberResult = await this.#client.organization.getActiveMember();
      if (memberResult.error) throw requestError(memberResult.error);
      const member = memberResult.data;
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

  async #requestWithResponse<T>(pathname: string, init?: JsonRequestInit) {
    const headers = new Headers(init?.headers);
    headers.set("electron-origin", this.#electronOrigin);
    const cookie = this.#client.getCookie();
    if (cookie) headers.set("cookie", cookie);
    let body = init?.body as BodyInit | null | undefined;
    if (body && !(body instanceof FormData) && typeof body !== "string") {
      headers.set("content-type", "application/json");
      body = JSON.stringify(body);
    }
    const response = await net.fetch(`${this.#baseUrl}${pathname}`, { ...init, headers, body });
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

  #publish(snapshot: AuthSnapshot) {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener(snapshot);
    return snapshot;
  }

  async #persistAndPublish(snapshot: AuthSnapshot) {
    this.#publish(snapshot);
    await this.#writePersisted({ snapshot });
    return snapshot;
  }

  async #clear() {
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
