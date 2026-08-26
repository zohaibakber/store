import type { AuthSession } from "@store/auth";
import type {
  ImportInventoryCommand,
  ImportInventoryCommandResult,
  IssueInvoiceCommand,
  IssueInvoiceResult,
  LegacyCatalogMigrationCommand,
  LegacyCatalogMigrationJobStatus,
  LegacyCatalogMigrationResult,
  LegacyCatalogMigrationStartRequest,
  LegacyCatalogMigrationStarted,
  LegacyCatalogReconciliationCommand,
  LegacyCatalogReconciliationResult,
  SyncOperation,
  WorkspaceSnapshot,
} from "@store/contracts";
import type { InvoiceAiClient, ProductScanAiClient } from "@store/services";
import type { RuntimeContext } from "alchemy";
import type { RateLimitError } from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import type { AuthError } from "../auth/session";
import type { LegacyMigrationQueueError } from "../electric/legacy-migration-worker";
import type { ElectricMutationResult } from "../electric/mutation-database";
import type { InventoryDatabaseError, InventoryProtocolError } from "../inventory/errors";
import type { InventoryActor } from "../inventory/model";

export interface SyncLiveInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly authenticationExpiresAt: number;
}

export interface ServerRuntimeContract {
  readonly electronProtocol: string;
  readonly powerSyncUrl: string;
  readonly trustedOrigins: ReadonlyArray<string>;
  readonly getSession: (
    headers: Headers,
  ) => Effect.Effect<AuthSession | null, AuthError, RuntimeContext | Scope.Scope>;
  readonly loadWorkspace: (
    headers: Headers,
  ) => Effect.Effect<WorkspaceSnapshot, AuthError, RuntimeContext | Scope.Scope>;
  readonly invoiceAi: Effect.Effect<InvoiceAiClient, never, RuntimeContext>;
  readonly productScanAi: Effect.Effect<ProductScanAiClient, never, RuntimeContext>;
  readonly limitProductScan: (
    key: string,
  ) => Effect.Effect<{ readonly success: boolean }, RateLimitError, RuntimeContext>;
  /** Compatibility bridge for deployed clients still backed by OrganizationStore. */
  readonly connectSyncLive: (
    input: SyncLiveInput,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse>;
  readonly writeElectricMutation: (
    actor: InventoryActor,
    operation: SyncOperation,
  ) => Effect.Effect<
    ElectricMutationResult,
    InventoryProtocolError | InventoryDatabaseError,
    RuntimeContext | Scope.Scope
  >;
  readonly issueInvoice: (
    actor: InventoryActor,
    command: IssueInvoiceCommand,
  ) => Effect.Effect<
    IssueInvoiceResult,
    InventoryProtocolError | InventoryDatabaseError,
    RuntimeContext | Scope.Scope
  >;
  readonly importInventory: (
    actor: InventoryActor,
    command: ImportInventoryCommand,
  ) => Effect.Effect<
    ImportInventoryCommandResult,
    InventoryProtocolError | InventoryDatabaseError,
    RuntimeContext | Scope.Scope
  >;
  readonly startLegacyCatalogMigration: (
    actor: InventoryActor,
    command: LegacyCatalogMigrationStartRequest,
  ) => Effect.Effect<
    LegacyCatalogMigrationStarted,
    InventoryDatabaseError | LegacyMigrationQueueError,
    RuntimeContext | Scope.Scope
  >;
  readonly getLegacyCatalogMigration: (
    actor: InventoryActor,
    jobId: string,
  ) => Effect.Effect<
    LegacyCatalogMigrationJobStatus | null,
    InventoryDatabaseError,
    RuntimeContext | Scope.Scope
  >;
  readonly migrateLegacyCatalogBatch: (
    actor: InventoryActor,
    command: LegacyCatalogMigrationCommand,
  ) => Effect.Effect<
    LegacyCatalogMigrationResult,
    InventoryProtocolError | InventoryDatabaseError,
    RuntimeContext | Scope.Scope
  >;
  readonly reconcileLegacyCatalog: (
    actor: InventoryActor,
    command: LegacyCatalogReconciliationCommand,
  ) => Effect.Effect<
    LegacyCatalogReconciliationResult,
    InventoryProtocolError | InventoryDatabaseError,
    RuntimeContext | Scope.Scope
  >;
}

export class ServerRuntime extends Context.Service<ServerRuntime, ServerRuntimeContract>()(
  "@store/server/ServerRuntime",
) {}
