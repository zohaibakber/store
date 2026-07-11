import * as Schema from "effect/Schema";

export const Note = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  body: Schema.String,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});
export type Note = typeof Note.Type;

export const CreateNoteInput = Schema.Struct({
  title: Schema.String,
  body: Schema.String,
});
export type CreateNoteInput = typeof CreateNoteInput.Type;

export const UpdateNoteInput = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  body: Schema.String,
});
export type UpdateNoteInput = typeof UpdateNoteInput.Type;

export const DeleteNoteInput = Schema.Struct({ id: Schema.String });
export type DeleteNoteInput = typeof DeleteNoteInput.Type;

export const ProductCategory = Schema.Literals(["medicine", "cosmetics", "general"]);
export type ProductCategory = typeof ProductCategory.Type;

export const Product = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  category: ProductCategory,
  barcode: Schema.NullOr(Schema.String),
  composition: Schema.NullOr(Schema.String),
  strength: Schema.NullOr(Schema.String),
  unitsPerPack: Schema.Number,
  costPrice: Schema.NullOr(Schema.Number),
  packPrice: Schema.NullOr(Schema.Number),
  unitPrice: Schema.NullOr(Schema.Number),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});
export type Product = typeof Product.Type;

export const CreateProductInput = Schema.Struct({
  name: Schema.String,
  category: ProductCategory,
  barcode: Schema.NullOr(Schema.String),
  composition: Schema.NullOr(Schema.String),
  strength: Schema.NullOr(Schema.String),
  unitsPerPack: Schema.Number,
  costPrice: Schema.NullOr(Schema.Number),
  packPrice: Schema.NullOr(Schema.Number),
  unitPrice: Schema.NullOr(Schema.Number),
});
export type CreateProductInput = typeof CreateProductInput.Type;

export const UpdateProductInput = Schema.Struct({
  id: Schema.String,
  ...CreateProductInput.fields,
});
export type UpdateProductInput = typeof UpdateProductInput.Type;

export const Batch = Schema.Struct({
  id: Schema.String,
  productId: Schema.String,
  batchNumber: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.Number),
  quantity: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});
export type Batch = typeof Batch.Type;

export const CreateBatchInput = Schema.Struct({
  productId: Schema.String,
  batchNumber: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.Number),
  quantity: Schema.Number,
});
export type CreateBatchInput = typeof CreateBatchInput.Type;

export type SyncPhase = "local-only" | "idle" | "syncing" | "error";

export interface SyncStatus {
  readonly phase: SyncPhase;
  readonly configured: boolean;
  readonly lastSyncedAt: number | null;
  readonly message: string;
}

export interface OfflineStoreApi {
  readonly listNotes: () => Promise<ReadonlyArray<Note>>;
  readonly createNote: (input: CreateNoteInput) => Promise<Note>;
  readonly updateNote: (input: UpdateNoteInput) => Promise<Note>;
  readonly deleteNote: (input: DeleteNoteInput) => Promise<void>;
  readonly getSyncStatus: () => Promise<SyncStatus>;
  readonly sync: () => Promise<SyncStatus>;
}
