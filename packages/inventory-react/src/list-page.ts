import type {
  InventorySubsetSpec,
  InventorySubsetSummarySpec,
  ReplicaSubsetReader,
  ReplicaSummaryReader,
  SubsetPredicate,
} from "@store/client-db";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { WorkspaceReadFailure } from "./errors";
import type { ListPage } from "./list-request";

const MAX_LIST_PAGE_SIZE = 100;

type ListSource = InventorySubsetSpec["source"];

export const allOf = (predicates: ReadonlyArray<SubsetPredicate>): SubsetPredicate | undefined => {
  const [only, ...others] = predicates;
  return others.length === 0 ? only : { _tag: "and", predicates };
};

export const pageSpec = <Column extends string>(
  source: ListSource,
  where: SubsetPredicate | undefined,
  page: ListPage<Column>,
): InventorySubsetSpec => {
  const pageSize = Math.min(MAX_LIST_PAGE_SIZE, Math.max(1, Math.floor(page.pageSize)));
  const spec: InventorySubsetSpec = {
    source,
    orderBy: [
      { column: page.sort.column, direction: page.sort.direction },
      { column: "id", direction: page.sort.direction },
    ],
    limit: pageSize,
    offset: Math.max(0, Math.floor(page.pageIndex)) * pageSize,
  };
  return where ? { ...spec, where } : spec;
};

export const summarySpec = (
  source: ListSource,
  where: SubsetPredicate | undefined,
  distinct: InventorySubsetSummarySpec["distinct"] = [],
): InventorySubsetSummarySpec => (where ? { source, where, distinct } : { source, distinct });

const decodePageRows = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ id: Schema.String })),
);

export const readPageIds = <Column extends string>(
  reader: ReplicaSubsetReader,
  source: ListSource,
  where: SubsetPredicate | undefined,
  page: ListPage<Column>,
  failure: () => WorkspaceReadFailure,
): Effect.Effect<ReadonlyArray<string>, WorkspaceReadFailure> =>
  Effect.tryPromise({
    try: () => reader.readSubset(pageSpec(source, where, page)),
    catch: failure,
  }).pipe(
    Effect.flatMap((read) => decodePageRows(read.rows)),
    Effect.map((rows) => rows.map((row) => row.id)),
    Effect.mapError(failure),
  );

export const countRows = (
  reader: ReplicaSummaryReader,
  source: ListSource,
  where: SubsetPredicate | undefined,
  failure: () => WorkspaceReadFailure,
): Effect.Effect<number, WorkspaceReadFailure> =>
  Effect.tryPromise({
    try: () => reader.summarizeSubset(summarySpec(source, where)),
    catch: failure,
  }).pipe(Effect.map((read) => read.summary.count));

export const inPageOrder = <Row extends { readonly id: string }>(
  ids: ReadonlyArray<string>,
  rows: ReadonlyArray<Row>,
): ReadonlyArray<Row> => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => byId.get(id) ?? []);
};
