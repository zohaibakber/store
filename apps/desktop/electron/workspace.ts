import {
  SyncResponse,
  type SyncRequest,
  type SyncStatus,
  type WorkspaceSnapshot,
} from "@store/contracts";
import { type OfflineStore, SyncTransportError } from "@store/persistence";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

type JsonRequestInit = Omit<RequestInit, "body"> & { body?: unknown };

export type WorkspaceCommand =
  | {
      readonly _tag: "SignIn";
      readonly email: string;
      readonly password: string;
    }
  | {
      readonly _tag: "SignUp";
      readonly name: string;
      readonly email: string;
      readonly password: string;
    }
  | { readonly _tag: "SignOut" }
  | { readonly _tag: "SwitchOrganization"; readonly organizationId: string }
  | { readonly _tag: "CreateOrganization"; readonly name: string };

export interface WorkspaceAuthAdapter {
  readonly snapshot: WorkspaceSnapshot;
  readonly initialize: () => Promise<WorkspaceSnapshot>;
  readonly signIn: (input: {
    readonly email: string;
    readonly password: string;
  }) => Promise<WorkspaceSnapshot>;
  readonly signUp: (input: {
    readonly name: string;
    readonly email: string;
    readonly password: string;
  }) => Promise<WorkspaceSnapshot>;
  readonly signOut: () => Promise<void>;
  readonly switchOrganization: (input: {
    readonly organizationId: string;
  }) => Promise<WorkspaceSnapshot>;
  readonly createOrganization: (input: { readonly name: string }) => Promise<WorkspaceSnapshot>;
  readonly apiRequest: <A>(pathname: string, init?: JsonRequestInit) => Promise<A>;
}

export type WorkspaceTarget =
  | { readonly _tag: "Locked" }
  | {
      readonly _tag: "Authenticated";
      readonly organizationId: string;
      readonly userId: string;
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

const unauthenticated = (
  isOnline: boolean,
  workspaceError: string | null = null,
): WorkspaceSnapshot => ({
  status: "unauthenticated",
  user: null,
  activeOrganization: null,
  organizations: [],
  isOnline,
  workspaceError,
});

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : "The local workspace could not be opened.";

const requestDetails = (cause: unknown) => {
  if (typeof cause !== "object" || cause === null) return {};
  const status = Reflect.get(cause, "status");
  const code = Reflect.get(cause, "code");
  return {
    ...(typeof status === "number" ? { status } : {}),
    ...(typeof code === "string" ? { code } : {}),
  };
};

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
  #snapshot = unauthenticated(false);
  #store: WorkspaceStore | undefined;
  #activeOrganizationId: string | null = null;
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

  request<A>(pathname: string, init?: JsonRequestInit): Promise<A> {
    return this.#auth.apiRequest<A>(pathname, init);
  }

  dispose(): Promise<void> {
    return this.#serialize(() => this.#disposeStore());
  }

  async #runCommand(command: WorkspaceCommand): Promise<WorkspaceSnapshot> {
    switch (command._tag) {
      case "SignIn":
        return this.#auth.signIn({ email: command.email, password: command.password });
      case "SignUp":
        return this.#auth.signUp({
          name: command.name,
          email: command.email,
          password: command.password,
        });
      case "SignOut":
        await this.#auth.signOut();
        return this.#auth.snapshot;
      case "SwitchOrganization":
        return this.#auth.switchOrganization({ organizationId: command.organizationId });
      case "CreateOrganization":
        return this.#auth.createOrganization({ name: command.name });
    }
  }

  async #activate(snapshot: WorkspaceSnapshot): Promise<WorkspaceSnapshot> {
    const organization = snapshot.status === "authenticated" ? snapshot.activeOrganization : null;
    if (
      organization &&
      organization.id === this.#activeOrganizationId &&
      this.#store !== undefined
    ) {
      return this.#publish({ ...snapshot, workspaceError: null });
    }

    await this.#disposeStore();
    const auth = this.#auth;
    const target: WorkspaceTarget =
      organization && snapshot.user
        ? {
            _tag: "Authenticated",
            organizationId: organization.id,
            userId: snapshot.user.id,
            deviceId: this.#deviceId,
            exchange: Effect.fn("AuthenticatedWorkspace.exchange")(function* (request) {
              const response = yield* Effect.tryPromise({
                try: (signal) =>
                  auth.apiRequest<unknown>("/api/sync", {
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
      return this.#publish({ ...snapshot, workspaceError: null });
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
