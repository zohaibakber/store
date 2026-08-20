import type { SyncRequest, SyncResponse } from "@store/contracts";
import type { SyncSocket } from "@store/sync-client";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { StoreDatabase } from "./database/client";
import type { PersistenceError, SyncTransportError } from "./errors";

/**
 * The signed-in user's selected organization together with the device its
 * mutations are attributed to. At most one is active per store runtime, so it
 * is a constant of that runtime rather than a per-call argument.
 */
export interface Workspace {
  readonly organizationId: string;
  readonly userId: string;
  readonly deviceId: string;
}

/** The authenticated workspace every local read, mutation, and sync exchange is scoped to. */
export class AuthenticatedWorkspace extends Context.Service<AuthenticatedWorkspace, Workspace>()(
  "@store/persistence/AuthenticatedWorkspace",
) {
  /** The workspace a locked, signed-out store runs under. */
  static readonly locked: Workspace = {
    organizationId: "local",
    userId: "local",
    deviceId: "local",
  };

  static readonly layer = (workspace: Workspace) =>
    Layer.succeed(AuthenticatedWorkspace, AuthenticatedWorkspace.of(workspace));
}

export type SyncTransport =
  | {
      readonly exchange: (request: SyncRequest) => Effect.Effect<SyncResponse, SyncTransportError>;
    }
  | {
      readonly openLive: Effect.Effect<SyncSocket, SyncTransportError>;
    };

export interface PersistenceConfig {
  readonly dataDir: string;
  /** Filesystem drizzle folder used by the Node/Electron replica. */
  readonly migrationsFolder?: string;
  /** Inlined drizzle SQL used by the browser replica (no filesystem). */
  readonly bundledMigrations?: Record<string, string>;
  readonly workspace?: Workspace;
  readonly syncTransport?: SyncTransport;
  /** Recorded on each sync exchange so the Durable Object can tell devices apart. */
  readonly clientPlatform?: string;
  readonly clientVersion?: string;
  /**
   * How often the engine re-signals a background sync. Default: 5 minutes
   * when a live socket is configured, otherwise 3 seconds.
   */
  readonly resyncIntervalMillis?: number;
  /**
   * Base delay of the exponential backoff used when retrying a failed sync
   * exchange. Default: 500ms. Tests set this low to avoid real waits.
   */
  readonly exchangeRetryBaseMillis?: number;
  /**
   * Node-only schema installer. The browser replica uses `bundledMigrations`
   * instead so this module never imports `node:fs`.
   */
  readonly applySchema?: (database: StoreDatabase) => Effect.Effect<unknown, PersistenceError>;
}
