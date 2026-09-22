import * as Schema from "effect/Schema";

import { MAX_SYNC_IDENTIFIER_LENGTH } from "./protocol";

export const InventoryObjectName = Schema.String.check(
  Schema.isPattern(/^inventory-[0-9a-z-]{1,64}$/u),
).pipe(Schema.brand("InventoryObjectName"));
export type InventoryObjectName = typeof InventoryObjectName.Type;

export const InventoryImportId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_SYNC_IDENTIFIER_LENGTH),
).pipe(Schema.brand("InventoryImportId"));
export type InventoryImportId = typeof InventoryImportId.Type;

export const InventoryReleaseId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_SYNC_IDENTIFIER_LENGTH),
).pipe(Schema.brand("InventoryReleaseId"));
export type InventoryReleaseId = typeof InventoryReleaseId.Type;
