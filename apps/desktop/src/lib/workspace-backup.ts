import * as Schema from "effect/Schema";

const Count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

export const CatalogCounts = Schema.Struct({
  products: Count,
  sales: Count,
  purchaseOrders: Count,
});
export type CatalogCounts = typeof CatalogCounts.Type;

const Cancelled = Schema.TaggedStruct("cancelled", {});
const Failed = Schema.TaggedStruct("failed", { message: Schema.String });

export const BackupOutcome = Schema.Union([
  Schema.TaggedStruct("saved", { fileName: Schema.String, bytes: Count }),
  Cancelled,
  Failed,
]);
export type BackupOutcome = typeof BackupOutcome.Type;

export const RestoreChoice = Schema.Union([
  Schema.TaggedStruct("staged", {
    fileName: Schema.String,
    current: CatalogCounts,
    backup: CatalogCounts,
  }),
  Cancelled,
  Failed,
]);
export type RestoreChoice = typeof RestoreChoice.Type;

export const RestoreOutcome = Schema.Union([Schema.TaggedStruct("restored", {}), Failed]);
export type RestoreOutcome = typeof RestoreOutcome.Type;

export type WorkspaceBackupBridge = {
  readonly backUp: () => Promise<BackupOutcome>;
  readonly chooseRestore: () => Promise<RestoreChoice>;
  readonly applyRestore: () => Promise<RestoreOutcome>;
  readonly discardRestore: () => Promise<void>;
};

const decodeBackupOutcome = Schema.decodeUnknownSync(BackupOutcome);
const decodeRestoreChoice = Schema.decodeUnknownSync(RestoreChoice);
const decodeRestoreOutcome = Schema.decodeUnknownSync(RestoreOutcome);

export const decodedBackupBridge = (bridge: WorkspaceBackupBridge): WorkspaceBackupBridge => ({
  backUp: async () => decodeBackupOutcome(await bridge.backUp()),
  chooseRestore: async () => decodeRestoreChoice(await bridge.chooseRestore()),
  applyRestore: async () => decodeRestoreOutcome(await bridge.applyRestore()),
  discardRestore: () => bridge.discardRestore(),
});
