import {
  compareUtf8,
  finishPartitionDigestReport,
  makePartitionEntityHasher,
  makePartitionLeafOrderer,
  partitionLeafOf,
  STOCK_MOVEMENT_ROW_VERSION,
  type PartitionDigestReport,
  type PartitionEntity,
  type PartitionEntityDigest,
} from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { partitionEntityDigests } from "../digest";
import { ReplicaStorageError } from "../errors";
import { generationBounds } from "./query";
import { entityStore, type ReplicaQueryBuilder } from "./schema";

const CHUNK_ROWS = 1_000;
const SCAN_ATTEMPTS = 3;
const FIRST_SURROGATE_UNIT = 0xd800;

type DigestRow = { readonly id: string; readonly version: string };

const outsideUtf16Agreement = (id: string): boolean => {
  for (let index = 0; index < id.length; index += 1) {
    if (id.charCodeAt(index) >= FIRST_SURROGATE_UNIT) return true;
  }
  return false;
};

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
  return api
    .from(entityStore(entity))
    .select()
    .between(lower, upper, { excludeLowerBound: Option.isSome(after) })
    .limit(CHUNK_ROWS)
    .pipe(
      Effect.map((rows) =>
        rows.map((row) => ({
          id: row.id,
          version: String("rowVersion" in row ? row.rowVersion : STOCK_MOVEMENT_ROW_VERSION),
        })),
      ),
    );
};

const countOf = (api: ReplicaQueryBuilder, entity: PartitionEntity, generation: number) => {
  const [lower, upper] = generationBounds(generation);
  return api.from(entityStore(entity)).count().between(lower, upper);
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

type DigestScan =
  | { readonly _tag: "settled"; readonly report: PartitionDigestReport | undefined }
  | { readonly _tag: "moved" };

export const indexedDbPartitionDigest = Effect.fn("IndexedDbDigest.partitionDigest")(
  function* (api: ReplicaQueryBuilder) {
    const before = yield* stateStamp(api);
    if ((yield* api.from("pending_row_marks").count()) > 0) {
      return { _tag: "settled", report: undefined } satisfies DigestScan;
    }
    const report = yield* finishPartitionDigestReport(
      yield* partitionEntityDigests((entity) => entityDigest(api, entity, before.generation)),
    );
    const after = yield* stateStamp(api);
    return (
      after.generation === before.generation && after.version === before.version
        ? { _tag: "settled", report }
        : { _tag: "moved" }
    ) satisfies DigestScan;
  },
  Effect.repeat({
    until: (scan: DigestScan) => scan._tag === "settled",
    times: SCAN_ATTEMPTS - 1,
  }),
  Effect.map((scan) => (scan._tag === "settled" ? scan.report : undefined)),
);
