import type { SyncRequest, SyncResponse } from "@store/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { SyncTransportError } from "./errors";

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
  /** The workspace a locked — that is, signed-out — store runs under. */
  static readonly locked: Workspace = {
    organizationId: "local",
    userId: "local",
    deviceId: "local",
  };

  static readonly layer = (workspace: Workspace) =>
    Layer.succeed(AuthenticatedWorkspace, AuthenticatedWorkspace.of(workspace));
}

export interface SyncTransport {
  readonly exchange: (request: SyncRequest) => Effect.Effect<SyncResponse, SyncTransportError>;
}

export interface PersistenceConfig {
  readonly dataDir: string;
  readonly migrationsFolder: string;
  readonly workspace?: Workspace;
  readonly syncTransport?: SyncTransport;
  /** How often the engine re-signals a background HTTP sync. Default: 3 seconds. */
  readonly resyncIntervalMillis?: number;
  /**
   * Base delay of the exponential backoff used when retrying a failed sync
   * exchange. Default: 500ms. Tests set this low to avoid real waits.
   */
  readonly exchangeRetryBaseMillis?: number;
}
