import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { isSqlError, type SqlError } from "effect/unstable/sql/SqlError";

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

type StorageFailure = SqlError | Schema.SchemaError;

const isStorageFailure = (cause: unknown): boolean =>
  isSqlError(cause) || Schema.isSchemaError(cause);

export const persistingAs =
  <Failure>(fail: (cause: StorageFailure) => Failure) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, Exclude<E, Extract<E, StorageFailure>> | Failure, R> =>
    effect.pipe(
      Effect.catchIf(
        (cause): cause is Extract<E, StorageFailure> => isStorageFailure(cause),
        (cause) => Effect.fail(fail(cause)),
        Effect.fail,
      ),
    );
