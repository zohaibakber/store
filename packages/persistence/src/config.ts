import type { SyncRequest, SyncResponse } from "@store/contracts";
import type * as Effect from "effect/Effect";
import type { SyncTransportError } from "./errors";

export interface MutationContext {
  readonly organizationId: string;
  readonly userId: string;
  readonly deviceId: string;
}

export interface SyncTransport {
  readonly exchange: (request: SyncRequest) => Effect.Effect<SyncResponse, SyncTransportError>;
}

export interface PersistenceConfig {
  readonly dataDir: string;
  readonly migrationsFolder: string;
  readonly mutationContext?: () => MutationContext;
  readonly syncTransport?: SyncTransport;
  /** How often the engine re-signals a background sync. Default: 5 minutes. */
  readonly resyncIntervalMillis?: number;
}

export const mutationContextFrom = (config: PersistenceConfig): (() => MutationContext) =>
  config.mutationContext ??
  (() => ({
    organizationId: "local",
    userId: "local",
    deviceId: "local",
  }));
