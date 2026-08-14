import { makeWebAuthClient, type WebAuthClient } from "@store/auth/web-client";
import { type WorkspaceSnapshot, type WorkspaceUser } from "@store/contracts";
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

const requestError = (error: { readonly message?: string; readonly status: number }) =>
  new RequestError(error.message ?? "Authentication request failed.", error.status);

const unauthenticated = (isOnline: boolean): WorkspaceSnapshot => ({
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

const navigatorOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine);

export class WebAuthBroker implements WorkspaceAuthAdapter {
  readonly #baseUrl: string;
  readonly #client: WebAuthClient;
  readonly #listeners = new Set<(snapshot: WorkspaceSnapshot) => void>();
  #snapshot: WorkspaceSnapshot = unauthenticated(false);

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl.replace(/\/api\/?$/, "").replace(/\/$/, "");
    this.#client = makeWebAuthClient({ baseURL: this.#baseUrl });
  }

  get snapshot() {
    return this.#snapshot;
  }

  onChange(listener: (snapshot: WorkspaceSnapshot) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async initialize() {
    return this.refresh();
  }

  async refresh() {
    try {
      const { data, error } = await this.#client.getSession();
      if (error) throw requestError(error);
      if (!data?.user) return this.#publish(unauthenticated(true));
      return this.#loadOrganizations(data.user);
    } catch (error) {
      if (error instanceof RequestError && (error.status === 401 || error.status === 403))
        return this.#publish(unauthenticated(true));
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
    return this.#publish({
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
    return this.#publish({
      ...this.#snapshot,
      activeOrganization: organization,
      organizations: [...this.#snapshot.organizations, organization],
      isOnline: true,
    });
  }

  async apiRequest<T>(pathname: string, init?: JsonRequestInit) {
    const headers = new Headers(init?.headers);
    let body = init?.body as BodyInit | null | undefined;
    if (body && !(body instanceof FormData) && typeof body !== "string") {
      headers.set("content-type", "application/json");
      body = JSON.stringify(body);
    }
    const response = await fetch(`${this.#baseUrl}${pathname}`, {
      ...init,
      body,
      credentials: "include",
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

  async #loadOrganizations(user: WorkspaceUser) {
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
    return this.#publish({
      status: "authenticated",
      user,
      activeOrganization: resolvedActive,
      organizations,
      isOnline: true,
    });
  }

  #publish(snapshot: WorkspaceSnapshot) {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener(snapshot);
    return snapshot;
  }
}
