import {
  SyncResponse,
  unauthenticatedWorkspace,
  withWorkspaceError,
  type OrganizationId,
  type SyncRequest,
  type SyncStatus,
  type UserId,
  type WorkspaceSnapshot,
} from "@store/contracts";
import { type OfflineStore, SyncTransportError } from "@store/persistence/core";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export type JsonRequestInit = Omit<RequestInit, "body"> & { body?: unknown };
export type JsonApiResponse = string | number | boolean | null | JsonApiObject | JsonApiResponse[];
export interface JsonApiObject {
  readonly [key: string]: JsonApiResponse;
}

export type WorkspaceCommand =
  | { readonly _tag: "AdoptSession"; readonly token: string | null }
  | { readonly _tag: "SignOut" };

export interface WorkspaceAuthAdapter {
  readonly snapshot: WorkspaceSnapshot;
  readonly initialize: () => Promise<WorkspaceSnapshot>;
  readonly adoptSession: (token: string | null) => Promise<WorkspaceSnapshot>;
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
      readonly exchange: (request: SyncRequest) => Effect.Effect<SyncResponse, SyncTransportError>;
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

const RequestFailureDetails = Schema.Struct({
  status: Schema.optional(Schema.Number),
  code: Schema.optional(Schema.String),
});

const requestDetails = (cause: unknown) =>
  Schema.decodeUnknownOption(RequestFailureDetails)(cause).pipe(
    Option.getOrElse(() => ({ status: undefined, code: undefined })),
  );

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
        return this.#auth.adoptSession(command.token);
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
    const auth = this.#auth;
    const target: WorkspaceTarget =
      snapshot.status === "authenticated" && organization
        ? {
            _tag: "Authenticated",
            organizationId: organization.id,
            userId: snapshot.user.id,
            deviceId: this.#deviceId,
            exchange: Effect.fn("AuthenticatedWorkspace.exchange")(function* (request) {
              const response = yield* Effect.tryPromise({
                try: (signal) =>
                  auth.apiRequest("/api/sync", {
                    method: "POST",
                    body: request,
                    signal,
                  }),
                catch: (cause) => {
                  const details = requestDetails(cause);
                  return SyncTransportError.make({
                    message: messageOf(cause),
                    retryable:
                      details.status === undefined ||
                      details.status === 401 ||
                      details.status === 408 ||
                      details.status === 429 ||
                      details.status >= 500,
                    ...details,
                    cause,
                  });
                },
              });
              return yield* Schema.decodeUnknownEffect(SyncResponse)(response).pipe(
                Effect.mapError((cause) =>
                  SyncTransportError.make({
                    message: "The sync server returned an invalid response.",
                    retryable: false,
                    code: "INVALID_SYNC_RESPONSE",
                    cause,
                  }),
                ),
              );
            }),
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
