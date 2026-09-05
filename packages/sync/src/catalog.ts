import type {
  CatalogWriteCommand,
  ImportInventoryCommand,
  IssueInvoiceCommand,
  SyncEntityChange,
} from "@store/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Stream from "effect/Stream";

import { CatalogError } from "./errors";
import type { ReplicaDiff, ReplicaSnapshot } from "./replica";

export const CatalogScope = Schema.Struct({
  organizationId: Schema.String,
  deviceId: Schema.String,
  apiOrigin: Schema.String,
  slices: Schema.optional(Schema.Array(Schema.Literals(["catalog", "sales"]))),
});
export type CatalogScope = typeof CatalogScope.Type;

export const CatalogStatus = Schema.Literals(["idle", "hydrating", "ready", "syncing", "offline"]);
export type CatalogStatus = typeof CatalogStatus.Type;

export type CatalogFailure =
  | { readonly _tag: "sync"; readonly error: CatalogError }
  | { readonly _tag: "upload"; readonly error: CatalogError };

export class Catalog extends Context.Service<
  Catalog,
  {
    readonly status: Stream.Stream<CatalogStatus>;
    readonly changes: Stream.Stream<ReplicaDiff>;
    readonly failures: Stream.Stream<CatalogFailure>;
    readonly snapshot: Effect.Effect<ReplicaSnapshot>;
    readonly write: (command: CatalogWriteCommand) => Effect.Effect<void, CatalogError>;
    readonly issueInvoice: (
      command: IssueInvoiceCommand,
      changes: ReadonlyArray<SyncEntityChange>,
    ) => Effect.Effect<void, CatalogError>;
    readonly importInventory: (
      command: ImportInventoryCommand,
    ) => Effect.Effect<void, CatalogError>;
    readonly poke: Effect.Effect<void>;
    readonly waitForIdle: Effect.Effect<void, CatalogError>;
  }
>()("store/Catalog") {}
