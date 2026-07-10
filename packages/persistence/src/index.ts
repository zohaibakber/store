import type { CreateNoteInput, Note, SyncStatus, UpdateNoteInput } from "@store/contracts";
import { desc, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/tursodatabase-sync";
import type { DatabaseOpts } from "@tursodatabase/sync";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { notes } from "./schema";

export interface PersistenceConfig {
  readonly path: string;
  readonly syncUrl?: string;
  readonly authToken?: string;
}

export class PersistenceError extends Schema.TaggedErrorClass<PersistenceError>()(
  "PersistenceError",
  { operation: Schema.String, message: Schema.String },
) {}

export class NoteNotFoundError extends Schema.TaggedErrorClass<NoteNotFoundError>()(
  "NoteNotFoundError",
  { id: Schema.String },
) {}

type StoreError = PersistenceError | NoteNotFoundError;

export class OfflineStore extends Context.Service<
  OfflineStore,
  {
    readonly listNotes: Effect.Effect<ReadonlyArray<Note>, PersistenceError>;
    readonly createNote: (input: CreateNoteInput) => Effect.Effect<Note, PersistenceError>;
    readonly updateNote: (input: UpdateNoteInput) => Effect.Effect<Note, StoreError>;
    readonly deleteNote: (id: string) => Effect.Effect<void, StoreError>;
    readonly getSyncStatus: Effect.Effect<SyncStatus>;
    readonly sync: Effect.Effect<SyncStatus, PersistenceError>;
  }
>()("@store/persistence/OfflineStore") {}

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const attempt = <A>(operation: string, evaluate: () => PromiseLike<A>) =>
  Effect.tryPromise({
    try: () => Promise.resolve(evaluate()),
    catch: (cause) => new PersistenceError({ operation, message: messageOf(cause) }),
  });

const make = (config: PersistenceConfig) =>
  Effect.gen(function* () {
    const configured = Boolean(config.syncUrl);
    let syncEnabled = false;
    const connection: DatabaseOpts = configured
      ? {
          path: config.path,
          url: () => (syncEnabled ? config.syncUrl! : null),
          ...(config.authToken ? { authToken: config.authToken } : {}),
          clientName: "store-electron",
        }
      : { path: config.path };
    const db = drizzle({
      connection,
    });

    yield* attempt("connect database", () => db.$client.connect());
    yield* attempt("initialize database", () =>
      db.run(sql`
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        )
      `),
    );

    const status = yield* Ref.make<SyncStatus>({
      phase: configured ? "idle" : "local-only",
      configured,
      lastSyncedAt: null,
      message: configured ? "Ready to sync" : "Add Turso credentials to enable cloud sync",
    });

    yield* Effect.addFinalizer(() =>
      attempt("close database", () => db.$client.close()).pipe(Effect.orDie),
    );

    const listNotes = attempt("list notes", () =>
      db
        .select({
          id: notes.id,
          title: notes.title,
          body: notes.body,
          createdAt: notes.createdAt,
          updatedAt: notes.updatedAt,
        })
        .from(notes)
        .where(isNull(notes.deletedAt))
        .orderBy(desc(notes.updatedAt))
        .all(),
    );

    const createNote = Effect.fn("OfflineStore.createNote")(function* (input: CreateNoteInput) {
      const now = Date.now();
      const note: Note = {
        id: crypto.randomUUID(),
        title: input.title.trim(),
        body: input.body.trim(),
        createdAt: now,
        updatedAt: now,
      };
      yield* attempt("create note", () => db.insert(notes).values(note).run());
      return note;
    });

    const updateNote = Effect.fn("OfflineStore.updateNote")(function* (input: UpdateNoteInput) {
      const existing = yield* attempt("find note", () =>
        db.select().from(notes).where(eq(notes.id, input.id)).get(),
      );
      if (!existing || existing.deletedAt !== null) {
        return yield* new NoteNotFoundError({ id: input.id });
      }
      const note: Note = {
        id: existing.id,
        title: input.title.trim(),
        body: input.body.trim(),
        createdAt: existing.createdAt,
        updatedAt: Date.now(),
      };
      yield* attempt("update note", () =>
        db
          .update(notes)
          .set({ title: note.title, body: note.body, updatedAt: note.updatedAt })
          .where(eq(notes.id, note.id))
          .run(),
      );
      return note;
    });

    const deleteNote = Effect.fn("OfflineStore.deleteNote")(function* (id: string) {
      const existing = yield* attempt("find note", () =>
        db.select({ id: notes.id }).from(notes).where(eq(notes.id, id)).get(),
      );
      if (!existing) return yield* new NoteNotFoundError({ id });
      yield* attempt("delete note", () =>
        db
          .update(notes)
          .set({ deletedAt: Date.now(), updatedAt: Date.now() })
          .where(eq(notes.id, id))
          .run(),
      );
    });

    const sync = Effect.fn("OfflineStore.sync")(function* () {
      if (!configured) return yield* Ref.get(status);
      yield* Ref.update(status, (current) => ({
        ...current,
        phase: "syncing" as const,
        message: "Pushing local changes…",
      }));
      syncEnabled = true;
      const result = yield* attempt("sync with Turso", async () => {
        await db.$client.push();
        await db.$client.pull();
      }).pipe(Effect.result);
      if (result._tag === "Failure") {
        yield* Ref.update(status, (current) => ({
          ...current,
          phase: "error" as const,
          message: result.failure.message,
        }));
        return yield* result.failure;
      }
      const next: SyncStatus = {
        phase: "idle",
        configured: true,
        lastSyncedAt: Date.now(),
        message: "Local and cloud data are in sync",
      };
      yield* Ref.set(status, next);
      return next;
    });

    return OfflineStore.of({
      listNotes,
      createNote,
      updateNote,
      deleteNote,
      getSyncStatus: Ref.get(status),
      sync: sync(),
    });
  });

export const layer = (config: PersistenceConfig) => Layer.effect(OfflineStore, make(config));

export const program = {
  listNotes: Effect.flatMap(OfflineStore, (store) => store.listNotes),
  createNote: (input: CreateNoteInput) =>
    Effect.flatMap(OfflineStore, (store) => store.createNote(input)),
  updateNote: (input: UpdateNoteInput) =>
    Effect.flatMap(OfflineStore, (store) => store.updateNote(input)),
  deleteNote: (id: string) => Effect.flatMap(OfflineStore, (store) => store.deleteNote(id)),
  getSyncStatus: Effect.flatMap(OfflineStore, (store) => store.getSyncStatus),
  sync: Effect.flatMap(OfflineStore, (store) => store.sync),
} as const;

export * from "./schema";
