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
} from "@store/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { CatalogError } from "./errors";

export interface InventoryMutationAck {
  readonly txid: number;
}

export class CatalogTransport extends Context.Service<
  CatalogTransport,
  {
    readonly pull: (request: CatalogPullRequest) => Effect.Effect<CatalogPullResult, CatalogError>;
    readonly snapshot: (
      request: CatalogSnapshotRequest,
    ) => Effect.Effect<CatalogSnapshotResult, CatalogError>;
    readonly write: (
      command: CatalogWriteCommand,
    ) => Effect.Effect<InventoryMutationAck, CatalogError>;
    readonly issueInvoice: (
      command: IssueInvoiceCommand,
    ) => Effect.Effect<IssueInvoiceResult, CatalogError>;
    readonly importInventory: (
      command: ImportInventoryCommand,
    ) => Effect.Effect<ImportInventoryCommandResult, CatalogError>;
  }
>()("store/CatalogTransport") {}
