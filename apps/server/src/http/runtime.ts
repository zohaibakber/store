import type { AuthSession } from "@store/auth";
import type {
  CatalogPullRequest,
  CatalogPullResult,
  CatalogSnapshotRequest,
  CatalogSnapshotResult,
  CatalogWriteCommand,
  ImportInventoryCommand,
  ImportInventoryCommandResult,
  IssueInvoiceCommand,
  IssueInvoiceResult,
  WorkspaceSnapshot,
} from "@store/contracts";
import type { InvoiceAiClient, ProductScanAiClient } from "@store/services";
import type { RuntimeContext } from "alchemy";
import type { RateLimitError } from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import type { AuthError } from "../auth/session";
import type { InventoryDatabaseError, InventoryProtocolError } from "../inventory/errors";
import type { InventoryActor } from "../inventory/model";
import type { InventoryMutationResult } from "../inventory/mutation-database";

export interface ServerRuntimeContract {
  readonly electronProtocol: string;
  readonly trustedOrigins: ReadonlyArray<string>;
  readonly getSession: (
    headers: Headers,
  ) => Effect.Effect<AuthSession | null, AuthError, RuntimeContext | Scope.Scope>;
  readonly loadWorkspace: (
    headers: Headers,
  ) => Effect.Effect<WorkspaceSnapshot, AuthError, RuntimeContext | Scope.Scope>;
  readonly invoiceAi: Effect.Effect<InvoiceAiClient, never, RuntimeContext>;
  readonly productScanAi: Effect.Effect<ProductScanAiClient, never, RuntimeContext>;
  readonly limitInvoiceExtraction: (
    key: string,
  ) => Effect.Effect<{ readonly success: boolean }, RateLimitError, RuntimeContext>;
  readonly limitProductScan: (
    key: string,
  ) => Effect.Effect<{ readonly success: boolean }, RateLimitError, RuntimeContext>;
  readonly writeInventoryMutation: (
    actor: InventoryActor,
    command: CatalogWriteCommand,
  ) => Effect.Effect<
    InventoryMutationResult,
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
  readonly pullCatalog: (
    organizationId: string,
    request: CatalogPullRequest,
  ) => Effect.Effect<CatalogPullResult, InventoryDatabaseError, RuntimeContext | Scope.Scope>;
  readonly snapshotCatalog: (
    organizationId: string,
    request: CatalogSnapshotRequest,
  ) => Effect.Effect<CatalogSnapshotResult, InventoryDatabaseError, RuntimeContext | Scope.Scope>;
}

export class ServerRuntime extends Context.Service<ServerRuntime, ServerRuntimeContract>()(
  "@store/server/ServerRuntime",
) {}
