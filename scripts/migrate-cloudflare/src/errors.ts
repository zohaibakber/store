import * as Schema from "effect/Schema";

export class MigrationInterrupted extends Schema.TaggedError<MigrationInterrupted>()(
  "Migrate.Interrupted",
  {
    checkpoint: Schema.String,
    message: Schema.String,
  },
) {}

export class SourceError extends Schema.TaggedError<SourceError>()("Migrate.SourceError", {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class TranslationFailed extends Schema.TaggedError<TranslationFailed>()(
  "Migrate.TranslationFailed",
  {
    table: Schema.String,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export class ManifestIncomplete extends Schema.TaggedError<ManifestIncomplete>()(
  "Migrate.ManifestIncomplete",
  {
    message: Schema.String,
  },
) {}

export class ChunkContentMismatch extends Schema.TaggedError<ChunkContentMismatch>()(
  "Migrate.ChunkContentMismatch",
  {
    organizationId: Schema.String,
    table: Schema.String,
    chunkIndex: Schema.Number,
    message: Schema.String,
  },
) {}

export class ImportRejected extends Schema.TaggedError<ImportRejected>()("Migrate.ImportRejected", {
  organizationId: Schema.String,
  message: Schema.String,
}) {}

export class ValidationFailed extends Schema.TaggedError<ValidationFailed>()(
  "Migrate.ValidationFailed",
  {
    organizationId: Schema.String,
    incompleteStep: Schema.String,
    message: Schema.String,
  },
) {}

export class PublicationFailed extends Schema.TaggedError<PublicationFailed>()(
  "Migrate.PublicationFailed",
  {
    incompleteStep: Schema.String,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export class PersistenceError extends Schema.TaggedError<PersistenceError>()(
  "Migrate.PersistenceError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export class ConfigurationError extends Schema.TaggedError<ConfigurationError>()(
  "Migrate.ConfigurationError",
  {
    message: Schema.String,
  },
) {}

export type MigrationError =
  | MigrationInterrupted
  | SourceError
  | TranslationFailed
  | ManifestIncomplete
  | ChunkContentMismatch
  | ImportRejected
  | ValidationFailed
  | PublicationFailed
  | PersistenceError
  | ConfigurationError;
