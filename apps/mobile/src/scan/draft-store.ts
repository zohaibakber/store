import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Directory, File, Paths } from "expo-file-system";

import { type ScanDraft, ScanDraftJson } from "./model";

export class DraftStorageError extends Schema.TaggedError<DraftStorageError>()(
  "DraftStorageError",
  { message: Schema.String, cause: Schema.Defect() },
) {}

export class DraftStore extends Context.Service<
  DraftStore,
  {
    readonly list: Effect.Effect<ReadonlyArray<ScanDraft>, DraftStorageError>;
    readonly save: (draft: ScanDraft) => Effect.Effect<void, DraftStorageError>;
    readonly adoptPhoto: (
      draftId: string,
      capturedPath: string,
    ) => Effect.Effect<string, DraftStorageError>;
    readonly remove: (draftId: string) => Effect.Effect<void, DraftStorageError>;
  }
>()("@store/mobile/scan/DraftStore") {}

const DRAFT_FILE = "draft.json";
const PENDING_FILE = "draft.json.pending";
const PHOTO_FILE = "photo.jpg";

const encodeDraft = Schema.encodeSync(ScanDraftJson);
const decodeDraft = Schema.decodeUnknownEffect(ScanDraftJson);

const draftsRoot = () => new Directory(Paths.document, "scan-drafts");
const draftDirectory = (draftId: string) => new Directory(draftsRoot(), draftId);

const fileUri = (path: string) => (path.startsWith("file://") ? path : `file://${path}`);

const storageError = (message: string) => (cause: unknown) =>
  new DraftStorageError({ message, cause });

const readDraft = (directory: Directory) => {
  const committed = new File(directory, DRAFT_FILE);
  const pending = new File(directory, PENDING_FILE);
  const source = committed.exists ? committed : pending.exists ? pending : null;
  if (source === null) return Effect.succeed(null);
  return Effect.tryPromise({
    try: () => source.text(),
    catch: storageError(`Could not read the scan draft in ${directory.name}.`),
  }).pipe(
    Effect.flatMap((text) => decodeDraft(text)),
    Effect.tapError((cause) =>
      Effect.logWarning("Scan draft skipped").pipe(
        Effect.annotateLogs({ draft: directory.name, cause: String(cause) }),
      ),
    ),
    Effect.orElseSucceed(() => null),
  );
};

export const fileDraftStore = Layer.succeed(DraftStore, {
  list: Effect.try({
    try: () => {
      const root = draftsRoot();
      root.create({ intermediates: true, idempotent: true });
      return root.list().flatMap((entry) => (entry instanceof Directory ? [entry] : []));
    },
    catch: storageError("Could not open the scan drafts folder."),
  }).pipe(
    Effect.flatMap((directories) => Effect.forEach(directories, readDraft)),
    Effect.map((drafts) =>
      drafts
        .flatMap((draft) => (draft === null ? [] : [draft]))
        .sort((left, right) => right.capturedAt - left.capturedAt),
    ),
  ),
  save: (draft) =>
    Effect.try({
      try: () => {
        const directory = draftDirectory(draft.id);
        directory.create({ intermediates: true, idempotent: true });
        const pending = new File(directory, PENDING_FILE);
        pending.create({ overwrite: true });
        pending.writeSync(encodeDraft(draft));
        pending.moveSync(new File(directory, DRAFT_FILE), { overwrite: true });
      },
      catch: storageError("Could not save the scan on this phone."),
    }),
  adoptPhoto: (draftId, capturedPath) =>
    Effect.tryPromise({
      try: async () => {
        const directory = draftDirectory(draftId);
        directory.create({ intermediates: true, idempotent: true });
        const photo = new File(directory, PHOTO_FILE);
        await new File(fileUri(capturedPath)).move(photo, { overwrite: true });
        return photo.uri;
      },
      catch: storageError("Could not keep the scan photo on this phone."),
    }),
  remove: (draftId) =>
    Effect.try({
      try: () => {
        const directory = draftDirectory(draftId);
        if (directory.exists) directory.delete();
      },
      catch: storageError("Could not delete the scan draft."),
    }),
});
