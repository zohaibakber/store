import * as Schema from "effect/Schema";

import { OrganizationId } from "../ids";
import { MAX_SYNC_IDENTIFIER_LENGTH, SyncEpoch } from "./protocol";

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

export const InventoryDirectoryEntry = Schema.TaggedUnion({
  importing: {
    organizationId: OrganizationId,
    objectName: InventoryObjectName,
    importId: InventoryImportId,
  },
  ready: {
    organizationId: OrganizationId,
    objectName: InventoryObjectName,
    importId: InventoryImportId,
    releaseId: InventoryReleaseId,
  },
});
export type InventoryDirectoryEntry = typeof InventoryDirectoryEntry.Type;

export const InventoryRoutingContext = Schema.Struct({
  organizationId: OrganizationId,
  importId: InventoryImportId,
  releaseId: InventoryReleaseId,
});
export type InventoryRoutingContext = typeof InventoryRoutingContext.Type;

export const InventoryObjectIdentity = Schema.TaggedUnion({
  importing: {
    organizationId: OrganizationId,
    importId: InventoryImportId,
  },
  ready: {
    organizationId: OrganizationId,
    importId: InventoryImportId,
    epoch: SyncEpoch,
  },
});
export type InventoryObjectIdentity = typeof InventoryObjectIdentity.Type;
