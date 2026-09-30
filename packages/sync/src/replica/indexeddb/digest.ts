import {
  compareUtf8,
  finishPartitionDigestReport,
  makePartitionEntityHasher,
  makePartitionLeafOrderer,
  partitionLeafOf,
  STOCK_MOVEMENT_ROW_VERSION,
  type PartitionEntity,
  type PartitionEntityDigest,
} from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { ReplicaStorageError } from "../errors";
import { generationBounds } from "./query";
import type { ReplicaQueryBuilder } from "./schema";

const CHUNK_ROWS = 1_000;
const MAX_ATTEMPTS = 3;
const FIRST_SURROGATE_UNIT = 0xd800;

type DigestRow = { readonly id: string; readonly version: string };

const outsideUtf16Agreement = (id: string): boolean => {
  for (let index = 0; index < id.length; index += 1) {
    if (id.charCodeAt(index) >= FIRST_SURROGATE_UNIT) return true;
  }
  return false;
};

const rowsOf = <Row extends { readonly id: string; readonly rowVersion: number }>(
  rows: ReadonlyArray<Row>,
): ReadonlyArray<DigestRow> => rows.map((row) => ({ id: row.id, version: String(row.rowVersion) }));

const chunkOf = (
  api: ReplicaQueryBuilder,
  entity: PartitionEntity,
  generation: number,
  after: Option.Option<string>,
): Effect.Effect<ReadonlyArray<DigestRow>, unknown> => {
  const lower: [number] | [number, string] = Option.match(after, {
    onNone: () => [generation],
    onSome: (id) => [generation, id],
  });
  const upper: [number, []] = [generation, []];
  const range = { excludeLowerBound: Option.isSome(after) };
  switch (entity) {
    case "category":
      return api
        .from("categories")
        .select()
        .between(lower, upper, range)
        .limit(CHUNK_ROWS)
        .pipe(Effect.map(rowsOf));
    case "product":
      return api
        .from("products")
        .select()
        .between(lower, upper, range)
        .limit(CHUNK_ROWS)
        .pipe(Effect.map(rowsOf));
    case "batch":
      return api
        .from("batches")
        .select()
        .between(lower, upper, range)
        .limit(CHUNK_ROWS)
        .pipe(Effect.map(rowsOf));
    case "invoice":
      return api
        .from("invoices")
        .select()
        .between(lower, upper, range)
        .limit(CHUNK_ROWS)
        .pipe(Effect.map(rowsOf));
    case "invoiceItem":
      return api
        .from("invoice_items")
        .select()
        .between(lower, upper, range)
        .limit(CHUNK_ROWS)
        .pipe(Effect.map(rowsOf));
    case "stockMovement":
      return api
        .from("stock_movements")
        .select()
        .between(lower, upper, range)
        .limit(CHUNK_ROWS)
        .pipe(
          Effect.map((rows) =>
            rows.map((row) => ({ id: row.id, version: String(STOCK_MOVEMENT_ROW_VERSION) })),
          ),
        );
  }
};

const countOf = (api: ReplicaQueryBuilder, entity: PartitionEntity, generation: number) => {
  const [lower, upper] = generationBounds(generation);
  switch (entity) {
    case "category":
      return api.from("categories").count().between(lower, upper);
    case "product":
      return api.from("products").count().between(lower, upper);
    case "batch":
      return api.from("batches").count().between(lower, upper);
    case "invoice":
      return api.from("invoices").count().between(lower, upper);
    case "invoiceItem":
      return api.from("invoice_items").count().between(lower, upper);
    case "stockMovement":
      return api.from("stock_movements").count().between(lower, upper);
  }
};

type EntityScan = {
  readonly digest: string;
  readonly outliers: ReadonlyArray<string>;
};

const scanEntity = (
  api: ReplicaQueryBuilder,
  entity: PartitionEntity,
  generation: number,
  count: number,
  knownOutliers: ReadonlyArray<string> | undefined,
): Effect.Effect<EntityScan, unknown> =>
  Effect.gen(function* () {
    const hasher = makePartitionEntityHasher(entity, count);
    const merged = knownOutliers ?? [];
    let merging = 0;
    const orderer = makePartitionLeafOrderer((leaf) => {
      while (merging < merged.length && compareUtf8(merged[merging] ?? "", leaf) < 0) {
        hasher.push(merged[merging] ?? "");
        merging += 1;
      }
      hasher.push(leaf);
    });
    const outliers: Array<string> = [];
    yield* Stream.paginate(Option.none<string>(), (after) =>
      chunkOf(api, entity, generation, after).pipe(
        Effect.map((rows) => {
          const last = rows.at(-1);
          return [
            rows,
            rows.length < CHUNK_ROWS || last === undefined
              ? Option.none()
              : Option.some(Option.some(last.id)),
          ] as const;
        }),
      ),
    ).pipe(
      Stream.runForEach((row) =>
        Effect.sync(() => {
          const leaf = partitionLeafOf(entity, row.id, row.version);
          if (outsideUtf16Agreement(row.id)) outliers.push(leaf);
          else orderer.push(row.id, leaf);
        }),
      ),
    );
    orderer.finish();
    while (merging < merged.length) {
      hasher.push(merged[merging] ?? "");
      merging += 1;
    }
    return { digest: hasher.finish(), outliers } satisfies EntityScan;
  });

const entityDigest = Effect.fn("IndexedDbDigest.entityDigest")(function* (
  api: ReplicaQueryBuilder,
  entity: PartitionEntity,
  generation: number,
) {
  const count = yield* countOf(api, entity, generation);
  const optimistic = yield* scanEntity(api, entity, generation, count, undefined);
  if (optimistic.outliers.length === 0) {
    return { count, digest: optimistic.digest } satisfies PartitionEntityDigest;
  }
  const settled = yield* scanEntity(
    api,
    entity,
    generation,
    count,
    [...optimistic.outliers].sort(compareUtf8),
  );
  return { count, digest: settled.digest } satisfies PartitionEntityDigest;
});

const stateStamp = (api: ReplicaQueryBuilder) =>
  api
    .from("replica_state")
    .select()
    .equals("singleton")
    .pipe(
      Effect.flatMap((rows) => {
        const state = rows[0];
        return state === undefined
          ? Effect.fail(ReplicaStorageError.make({ message: "Replica state is missing." }))
          : Effect.succeed({
              generation: state.activeGeneration,
              version: state.localCommitVersion,
            });
      }),
    );

export const indexedDbPartitionDigest = Effect.fn("IndexedDbDigest.partitionDigest")(function* (
  api: ReplicaQueryBuilder,
) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const before = yield* stateStamp(api);
    if ((yield* api.from("pending_row_marks").count()) > 0) return undefined;
    const report = yield* finishPartitionDigestReport({
      category: yield* entityDigest(api, "category", before.generation),
      product: yield* entityDigest(api, "product", before.generation),
      batch: yield* entityDigest(api, "batch", before.generation),
      invoice: yield* entityDigest(api, "invoice", before.generation),
      invoiceItem: yield* entityDigest(api, "invoiceItem", before.generation),
      stockMovement: yield* entityDigest(api, "stockMovement", before.generation),
    });
    const after = yield* stateStamp(api);
    if (after.generation === before.generation && after.version === before.version) return report;
  }
  return undefined;
});
