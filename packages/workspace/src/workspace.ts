import type { TokenSet } from "@store/auth";
import {
  unauthenticatedWorkspace,
  withWorkspaceError,
  type OrganizationId,
  type SyncStatus,
  type UserId,
  type WorkspaceSnapshot,
} from "@store/contracts";
import type { OfflineStore } from "@store/persistence/core";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

/** JSON-serializable values accepted at the HTTP boundary. */
export type JsonSerializable =
  | string
  | number
  | boolean
  | null
  | readonly JsonSerializable[]
  | { readonly [key: string]: JsonSerializable };

/**
 * Bodies session HTTP clients accept: JSON-serializable payloads (stringified
 * before send) plus platform bodies passed through verbatim.
 */
export type JsonRequestPayload = JsonSerializable | FormData;

export type JsonRequestInit = Omit<RequestInit, "body"> & { body?: JsonRequestPayload };
export type JsonApiResponse =
  | string
  | number
  | boolean
  | null
  | JsonApiObject
  | readonly JsonApiResponse[];
export interface JsonApiObject {
  readonly [key: string]: JsonApiResponse;
}

export type WorkspaceCommand =
  | { readonly _tag: "AdoptSession"; readonly tokens: TokenSet | null }
  | { readonly _tag: "SignOut" }
  /**
   * Trades the refresh token for a new access token straight away. The claims
   * carry the organization's name and the session's active organization, so a
   * rename or a redeemed invitation only reaches the app once the token that
   * still names the old one has been replaced.
   */
  | { readonly _tag: "RenewSession" };

export interface WorkspaceAuthAdapter {
  readonly snapshot: WorkspaceSnapshot;
  readonly initialize: () => Promise<WorkspaceSnapshot>;
  readonly adoptSession: (tokens: TokenSet | null) => Promise<WorkspaceSnapshot>;
  readonly renewSession: () => Promise<WorkspaceSnapshot>;
  readonly signOut: () => Promise<void>;
  readonly apiRequest: (pathname: string, init?: JsonRequestInit) => Promise<JsonApiResponse>;
  /** The same, against the authentication service rather than the store API. */
  readonly authRequest: (pathname: string, init?: JsonRequestInit) => Promise<JsonApiResponse>;
}

export type WorkspaceTarget =
  | { readonly _tag: "Locked" }
  | {
      readonly _tag: "Authenticated";
      readonly organizationId: OrganizationId;
      readonly userId: UserId;
      readonly deviceId: string;
    };

export interface WorkspaceStore {
  readonly run: <A, E>(effect: Effect.Effect<A, E, OfflineStore>) => Promise<A>;
  readonly sync: () => Promise<SyncStatus>;
  readonly onSyncStatusChange: (listener: (status: SyncStatus) => void) => () => void;
  readonly dispose: () => Promise<void>;
}

export interface WorkspaceStoreAdapter {
  readonly open: (target: WorkspaceTarget) => Promise<WorkspaceStore>;
}

export interface WorkspaceEvents {
  readonly publishSnapshot: (snapshot: WorkspaceSnapshot) => void;
  readonly publishSyncStatus: (status: SyncStatus) => void;
}

/** Host policy refused opening a Locked guest store (browser auth wall). */
export class GuestWorkspaceRefused extends Schema.TaggedError<GuestWorkspaceRefused>()(
  "Workspace.GuestWorkspaceRefused",
  {},
) {}

const unauthenticated = (isOnline: boolean, workspaceError: string | null = null) =>
  unauthenticatedWorkspace({ isOnline, workspaceError });

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : "The local workspace could not be opened.";

const isGuestWorkspaceRefused = (cause: unknown): cause is GuestWorkspaceRefused =>
  cause instanceof GuestWorkspaceRefused;

export class WorkspaceActivationError extends Error {
  override readonly name = "WorkspaceActivationError";
  readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.cause = cause;
  }
}

const hasActiveOrganization = (snapshot: WorkspaceSnapshot): boolean =>
  snapshot.status === "authenticated" && snapshot.activeOrganization != null;

export class AuthenticatedWorkspace {
  readonly #auth: WorkspaceAuthAdapter;
  readonly #stores: WorkspaceStoreAdapter;
  readonly #events: WorkspaceEvents;
  readonly #deviceId: string;
  readonly #allowsGuestWorkspace: boolean;
  readonly #lock = Semaphore.makeUnsafe(1);
  #snapshot: WorkspaceSnapshot = unauthenticated(false);
  #store: WorkspaceStore | undefined;
  #activeOrganizationId: OrganizationId | null = null;
  #stopSyncStatus: (() => void) | undefined;
  /** Auth snapshot waiting for {@link activateResolved} (web cold-start). */
  #resolvedAuth: WorkspaceSnapshot | undefined;

  constructor(input: {
    readonly auth: WorkspaceAuthAdapter;
    readonly stores: WorkspaceStoreAdapter;
    readonly events: WorkspaceEvents;
    readonly deviceId: string;
    /**
     * When false (browser), unsigned bootstrap skips opening a Locked store.
     * Desktop keeps true so offline/guest inventory remains available.
     */
    readonly allowsGuestWorkspace?: boolean;
  }) {
    this.#auth = input.auth;
    this.#stores = input.stores;
    this.#events = input.events;
    this.#deviceId = input.deviceId;
    this.#allowsGuestWorkspace = input.allowsGuestWorkspace ?? true;
  }

  get snapshot(): WorkspaceSnapshot {
    return this.#snapshot;
  }

  /** True once an OfflineStore handle is open (Authenticated or Locked). */
  get hasStore(): boolean {
    return this.#store !== undefined;
  }

  initialize(): Promise<WorkspaceSnapshot> {
    return this.#serialize(async () => {
      const snapshot = await this.#auth.initialize();
      try {
        return await this.#activate(snapshot);
      } catch {
        return this.#snapshot;
      }
    });
  }

  /**
   * Auth only. Unsigned / guest-refused hosts publish immediately without a
   * store. Authenticated sessions are returned but not published until
   * {@link activateResolved} opens OfflineStore — so admit never sees an
   * authenticated snapshot before `runStore` works.
   */
  resolveAuth(): Promise<WorkspaceSnapshot> {
    return this.#serialize(async () => {
      const snapshot = await this.#auth.initialize();
      if (!hasActiveOrganization(snapshot)) {
        this.#resolvedAuth = undefined;
        try {
          return await this.#activate(snapshot);
        } catch {
          return this.#snapshot;
        }
      }
      this.#resolvedAuth = snapshot;
      return snapshot;
    });
  }

  /** Opens the store for a session previously returned by {@link resolveAuth}. */
  activateResolved(): Promise<WorkspaceSnapshot> {
    return this.#serialize(async () => {
      const snapshot = this.#resolvedAuth ?? this.#auth.snapshot;
      this.#resolvedAuth = undefined;
      try {
        return await this.#activate(snapshot);
      } catch {
        return this.#snapshot;
      }
    });
  }

  execute(command: WorkspaceCommand): Promise<WorkspaceSnapshot> {
    return this.#serialize(async () => {
      this.#resolvedAuth = undefined;
      const snapshot = await this.#runCommand(command);
      return this.#activate(snapshot);
    });
  }

  runStore<A, E>(effect: Effect.Effect<A, E, OfflineStore>): Promise<A> {
    if (!this.#store) return Promise.reject(new Error("The local store is not ready"));
    return this.#store.run(effect);
  }

  request(pathname: string, init?: JsonRequestInit): Promise<JsonApiResponse> {
    return this.#auth.apiRequest(pathname, init);
  }

  authRequest(pathname: string, init?: JsonRequestInit): Promise<JsonApiResponse> {
    return this.#auth.authRequest(pathname, init);
  }

  /** Host-owned background start; call only after the first UI frame is visible. */
  async startSync(): Promise<void> {
    const store = this.#store;
    if (!store || this.#snapshot.status !== "authenticated" || !this.#snapshot.isOnline) return;
    await store.sync();
  }

  dispose(): Promise<void> {
    return this.#serialize(() => this.#disposeStore());
  }

  async #runCommand(command: WorkspaceCommand): Promise<WorkspaceSnapshot> {
    switch (command._tag) {
      case "AdoptSession":
        return this.#auth.adoptSession(command.tokens);
      case "RenewSession":
        return this.#auth.renewSession();
      case "SignOut":
        await this.#auth.signOut();
        return this.#auth.snapshot;
      default: {
        const _exhaustive: never = command;
        return _exhaustive;
      }
    }
  }

  async #activate(snapshot: WorkspaceSnapshot): Promise<WorkspaceSnapshot> {
    const organization = snapshot.status === "authenticated" ? snapshot.activeOrganization : null;
    if (
      organization &&
      organization.id === this.#activeOrganizationId &&
      this.#store !== undefined
    ) {
      return this.#publish(withWorkspaceError(snapshot, null));
    }

    await this.#disposeStore();
    const target: WorkspaceTarget =
      snapshot.status === "authenticated" && organization
        ? {
            _tag: "Authenticated",
            organizationId: organization.id,
            userId: snapshot.user.id,
            deviceId: this.#deviceId,
          }
        : { _tag: "Locked" };

    if (target._tag === "Locked" && !this.#allowsGuestWorkspace) {
      return this.#publish(unauthenticated(snapshot.isOnline, null));
    }

    try {
      const store = await this.#stores.open(target);
      this.#store = store;
      this.#activeOrganizationId = target._tag === "Authenticated" ? target.organizationId : null;
      this.#stopSyncStatus = store.onSyncStatusChange(this.#events.publishSyncStatus);
      // Publish before first sync so web `#boot-shell` / React mount are not blocked on
      // WS handshake + pull drain. Tradeoff: route loaders can briefly see an empty local
      // DB; they should soft-block on sync status (or revalidate) rather than boot awaiting
      // drain. Sync status still flows via onSyncStatusChange.
      const published = this.#publish(
        withWorkspaceError(
          snapshot,
          target._tag === "Authenticated" ? null : (snapshot.workspaceError ?? null),
        ),
      );
      return published;
    } catch (cause) {
      if (isGuestWorkspaceRefused(cause)) {
        return this.#publish(unauthenticated(snapshot.isOnline, null));
      }
      if (target._tag === "Authenticated") {
        const recovery = await this.#recoverLocked(snapshot.isOnline);
        if (recovery === "guest-refused") return this.#snapshot;
      }
      const message = messageOf(cause);
      this.#publish(unauthenticated(snapshot.isOnline, message));
      throw new WorkspaceActivationError(message, cause);
    }
  }

  async #recoverLocked(isOnline: boolean): Promise<"opened" | "guest-refused" | "failed"> {
    try {
      const store = await this.#stores.open({ _tag: "Locked" });
      this.#store = store;
      this.#activeOrganizationId = null;
      this.#stopSyncStatus = store.onSyncStatusChange(this.#events.publishSyncStatus);
      return "opened";
    } catch (cause) {
      this.#store = undefined;
      this.#activeOrganizationId = null;
      if (isGuestWorkspaceRefused(cause)) {
        this.#publish(unauthenticated(isOnline, null));
        return "guest-refused";
      }
      this.#publish(unauthenticated(isOnline, messageOf(cause)));
      return "failed";
    }
  }

  async #disposeStore() {
    const current = this.#store;
    this.#stopSyncStatus?.();
    this.#stopSyncStatus = undefined;
    this.#store = undefined;
    this.#activeOrganizationId = null;
    if (current) await current.dispose();
  }

  #publish(snapshot: WorkspaceSnapshot) {
    this.#snapshot = snapshot;
    this.#events.publishSnapshot(snapshot);
    return snapshot;
  }

  #serialize<A>(run: () => Promise<A>): Promise<A> {
    return Effect.runPromise(
      this.#lock.withPermit(Effect.tryPromise({ try: run, catch: (cause) => cause })),
    );
  }
}
