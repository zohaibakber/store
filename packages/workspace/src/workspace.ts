import {
  unauthenticatedWorkspace,
  withWorkspaceError,
  type OrganizationId,
  type SyncStatus,
  type UserId,
  type WorkspaceSnapshot,
} from "@store/contracts";
import type { TokenSet } from "@store/auth";
import type { OfflineStore } from "@store/persistence/core";
import type * as Effect from "effect/Effect";

export type JsonRequestInit = Omit<RequestInit, "body"> & { body?: unknown };
export type JsonApiResponse = string | number | boolean | null | JsonApiObject | JsonApiResponse[];
export interface JsonApiObject {
  readonly [key: string]: JsonApiResponse;
}

export type WorkspaceCommand =
  | { readonly _tag: "AdoptSession"; readonly tokens: TokenSet | null }
  | { readonly _tag: "SignOut" };

export interface WorkspaceAuthAdapter {
  readonly snapshot: WorkspaceSnapshot;
  readonly initialize: () => Promise<WorkspaceSnapshot>;
  readonly adoptSession: (tokens: TokenSet | null) => Promise<WorkspaceSnapshot>;
  readonly signOut: () => Promise<void>;
  readonly apiRequest: (pathname: string, init?: JsonRequestInit) => Promise<JsonApiResponse>;
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

const unauthenticated = (isOnline: boolean, workspaceError: string | null = null) =>
  unauthenticatedWorkspace({ isOnline, workspaceError });

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : "The local workspace could not be opened.";

export class WorkspaceActivationError extends Error {
  override readonly name = "WorkspaceActivationError";
  readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.cause = cause;
  }
}

export class AuthenticatedWorkspace {
  readonly #auth: WorkspaceAuthAdapter;
  readonly #stores: WorkspaceStoreAdapter;
  readonly #events: WorkspaceEvents;
  readonly #deviceId: string;
  #snapshot: WorkspaceSnapshot = unauthenticated(false);
  #store: WorkspaceStore | undefined;
  #activeOrganizationId: OrganizationId | null = null;
  #stopSyncStatus: (() => void) | undefined;
  #transition = Promise.resolve();

  constructor(input: {
    readonly auth: WorkspaceAuthAdapter;
    readonly stores: WorkspaceStoreAdapter;
    readonly events: WorkspaceEvents;
    readonly deviceId: string;
  }) {
    this.#auth = input.auth;
    this.#stores = input.stores;
    this.#events = input.events;
    this.#deviceId = input.deviceId;
  }

  get snapshot(): WorkspaceSnapshot {
    return this.#snapshot;
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

  execute(command: WorkspaceCommand): Promise<WorkspaceSnapshot> {
    return this.#serialize(async () => {
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

  dispose(): Promise<void> {
    return this.#serialize(() => this.#disposeStore());
  }

  async #runCommand(command: WorkspaceCommand): Promise<WorkspaceSnapshot> {
    switch (command._tag) {
      case "AdoptSession":
        return this.#auth.adoptSession(command.tokens);
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

    try {
      const store = await this.#stores.open(target);
      this.#store = store;
      this.#activeOrganizationId = target._tag === "Authenticated" ? target.organizationId : null;
      this.#stopSyncStatus = store.onSyncStatusChange(this.#events.publishSyncStatus);
      if (target._tag === "Authenticated" && snapshot.isOnline) {
        // Route loaders run as soon as the authenticated snapshot is published.
        // Finish the first pull so they cannot cache an empty pre-sync database.
        await store.sync().catch(() => undefined);
      }
      return this.#publish(
        withWorkspaceError(
          snapshot,
          target._tag === "Authenticated" ? null : (snapshot.workspaceError ?? null),
        ),
      );
    } catch (cause) {
      if (target._tag === "Authenticated") await this.#recoverLocked(snapshot.isOnline);
      const message = messageOf(cause);
      this.#publish(unauthenticated(snapshot.isOnline, message));
      throw new WorkspaceActivationError(message, cause);
    }
  }

  async #recoverLocked(isOnline: boolean) {
    try {
      const store = await this.#stores.open({ _tag: "Locked" });
      this.#store = store;
      this.#activeOrganizationId = null;
      this.#stopSyncStatus = store.onSyncStatusChange(this.#events.publishSyncStatus);
    } catch (cause) {
      this.#store = undefined;
      this.#activeOrganizationId = null;
      this.#publish(unauthenticated(isOnline, messageOf(cause)));
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
    const result = this.#transition.then(run, run);
    this.#transition = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
