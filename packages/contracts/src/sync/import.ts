import * as Schema from "effect/Schema";

import { OrganizationId } from "../ids";
import { PositiveInt, Sha256Hex } from "../schema-primitives";
import { OrgCommitSequence, PartitionDigest } from "./protocol";
import { MAX_SNAPSHOT_PART_BYTES, MAX_SNAPSHOT_PART_ROWS } from "./snapshot";

export const MAX_IMPORT_PARTS = 1_024;

export const MAX_IMPORT_PART_BYTES = MAX_SNAPSHOT_PART_BYTES;

export const MAX_IMPORT_PART_ROWS = MAX_SNAPSHOT_PART_ROWS;

export const ImportId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._-]{1,200}$/u)).pipe(
  Schema.brand("ImportId"),
);
export type ImportId = typeof ImportId.Type;

export const ImportPartNumber = PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_IMPORT_PARTS));
export type ImportPartNumber = typeof ImportPartNumber.Type;

export const ImportPartReceipt = Schema.Struct({
  partNumber: ImportPartNumber,
  byteLength: Schema.Natural,
  sha256: Sha256Hex,
});
export type ImportPartReceipt = typeof ImportPartReceipt.Type;

export const ImportCatalogRequest = Schema.Struct({
  organizationId: OrganizationId,
  partCount: ImportPartNumber,
  digest: PartitionDigest,
  digestVersion: PositiveInt,
});
export type ImportCatalogRequest = typeof ImportCatalogRequest.Type;

export const ImportCatalogResult = Schema.Struct({
  importId: ImportId,
  horizon: OrgCommitSequence,
  entityCounts: Schema.Array(Schema.Struct({ entity: Schema.String, rowCount: Schema.Natural })),
  digest: PartitionDigest,
  digestVersion: PositiveInt,
});
export type ImportCatalogResult = typeof ImportCatalogResult.Type;

export const ImportStatus = Schema.Union([
  Schema.TaggedStruct("committed", { result: ImportCatalogResult }),
  Schema.TaggedStruct("other", { message: Schema.String }),
  Schema.TaggedStruct("none", {}),
]);
export type ImportStatus = typeof ImportStatus.Type;
