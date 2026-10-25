import * as Schema from "effect/Schema";

export const CatalogCounts = Schema.Struct({
  products: Schema.Natural,
  sales: Schema.Natural,
  purchaseOrders: Schema.Natural,
});
export type CatalogCounts = typeof CatalogCounts.Type;

const Cancelled = Schema.TaggedStruct("cancelled", {});
const Failed = Schema.TaggedStruct("failed", { message: Schema.String });

export const BackupSaved = Schema.Union([
  Schema.TaggedStruct("saved", { fileName: Schema.String, bytes: Schema.Natural }),
  Cancelled,
]);
export type BackupOutcome = typeof BackupSaved.Type | typeof Failed.Type;

export const RestoreStaged = Schema.Union([
  Schema.TaggedStruct("staged", {
    fileName: Schema.String,
    current: CatalogCounts,
    backup: CatalogCounts,
  }),
  Cancelled,
]);
export type RestoreChoice = typeof RestoreStaged.Type | typeof Failed.Type;

export const RestoreApplied = Schema.TaggedStruct("restored", {});
export type RestoreOutcome = typeof RestoreApplied.Type | typeof Failed.Type;

export type WorkspaceBackupBridge = {
  readonly backUp: () => Promise<BackupOutcome>;
  readonly chooseRestore: () => Promise<RestoreChoice>;
  readonly applyRestore: () => Promise<RestoreOutcome>;
  readonly discardRestore: () => Promise<void>;
};
