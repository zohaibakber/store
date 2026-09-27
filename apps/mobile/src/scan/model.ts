import { ProductScanMode, ProductScanResult } from "@store/contracts/server-api.schema";
import * as Schema from "effect/Schema";

export { ProductScanMode, ProductScanResult };

export const ParseState = Schema.Union([
  Schema.TaggedStruct("Waiting", {}),
  Schema.TaggedStruct("Deferred", {}),
  Schema.TaggedStruct("RateLimited", { retryAt: Schema.Finite }),
  Schema.TaggedStruct("Failed", { attempts: Schema.Int, reason: Schema.String }),
  Schema.TaggedStruct("Parsed", { result: ProductScanResult, parsedAt: Schema.Finite }),
  Schema.TaggedStruct("Manual", {}),
]);
export type ParseState = typeof ParseState.Type;

export const ReviewEdits = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  composition: Schema.optionalKey(Schema.String),
  strength: Schema.optionalKey(Schema.String),
  unitsPerPack: Schema.optionalKey(Schema.String),
  batchNumber: Schema.optionalKey(Schema.String),
  expiresAt: Schema.optionalKey(Schema.String),
});
export type ReviewEdits = typeof ReviewEdits.Type;

export const ScanDraft = Schema.Struct({
  id: Schema.NonEmptyString,
  mode: ProductScanMode,
  photoUri: Schema.NullOr(Schema.String),
  recognizedText: Schema.String,
  lines: Schema.Array(Schema.String),
  packs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  capturedAt: Schema.Finite,
  updatedAt: Schema.Finite,
  parse: ParseState,
  edits: Schema.optionalKey(ReviewEdits),
});
export type ScanDraft = typeof ScanDraft.Type;

export const ScanDraftJson = Schema.fromJsonString(ScanDraft);

export const LOW_CONFIDENCE = 0.6;
export const MAX_PARSE_ATTEMPTS = 2;

export const isAwaitingParse = (parse: ParseState): boolean =>
  parse._tag === "Waiting" || parse._tag === "Deferred" || parse._tag === "RateLimited";

export const canRetryParse = (parse: ParseState): boolean =>
  parse._tag === "Failed" && parse.attempts < MAX_PARSE_ATTEMPTS;
