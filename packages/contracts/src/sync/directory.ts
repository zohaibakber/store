import * as Schema from "effect/Schema";

import { SyncIdentifier } from "../schema-primitives";

export const InventoryObjectName = Schema.String.check(
  Schema.isPattern(/^inventory-[0-9a-z-]{1,64}$/u),
).pipe(Schema.brand("InventoryObjectName"));
export type InventoryObjectName = typeof InventoryObjectName.Type;

export const InventoryImportId = SyncIdentifier.pipe(Schema.brand("InventoryImportId"));
export type InventoryImportId = typeof InventoryImportId.Type;

export const InventoryReleaseId = SyncIdentifier.pipe(Schema.brand("InventoryReleaseId"));
export type InventoryReleaseId = typeof InventoryReleaseId.Type;
