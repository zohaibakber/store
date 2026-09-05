import type {
  CatalogBatchCommand as ContractCatalogBatchCommand,
  CatalogBatchResult as ContractCatalogBatchResult,
  CatalogPullRequest,
  CatalogPullResult,
  CatalogSnapshotRequest,
  CatalogSnapshotResult,
} from "@store/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

import type { CatalogError } from "./errors";

export interface InventoryMutationAck {
  readonly txid: number;
}

export type CatalogBatchCommand = ContractCatalogBatchCommand;
export type CatalogBatchResult = ContractCatalogBatchResult["results"][number];

export interface CatalogBatchAck {
  readonly results: ContractCatalogBatchResult["results"];
}

export interface CatalogLiveHint {
  readonly epoch: number;
  readonly cursor: number;
}

export class CatalogTransport extends Context.Service<
  CatalogTransport,
  {
    readonly pull: (request: CatalogPullRequest) => Effect.Effect<CatalogPullResult, CatalogError>;
    readonly snapshot: (
      request: CatalogSnapshotRequest,
    ) => Effect.Effect<CatalogSnapshotResult, CatalogError>;
    readonly batch: (
      commands: ReadonlyArray<CatalogBatchCommand>,
    ) => Effect.Effect<CatalogBatchAck, CatalogError>;
    readonly live: Stream.Stream<CatalogLiveHint, CatalogError>;
  }
>()("store/CatalogTransport") {}
