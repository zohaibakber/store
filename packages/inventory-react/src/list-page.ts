import type {
  InventorySubsetSpec,
  InventorySubsetSummarySpec,
  ReplicaRow,
  ReplicaSubsetReader,
  ReplicaSummaryReader,
  SubsetPredicate,
} from "@store/client-db";
import * as Effect from "effect/Effect";

import type { WorkspaceReadFailure } from "./errors";

export const MAX_LIST_PAGE_SIZE = 100;

export const MAX_LIST_SEARCH_LENGTH = 120;

export type ListSort<Column extends string> = {
  readonly column: Column;
  readonly direction: "asc" | "desc";
};

export type ListPage<Column extends string> = {
  readonly sort: ListSort<Column>;
  readonly pageIndex: number;
  readonly pageSize: number;
};

type ListSource = InventorySubsetSpec["source"];

export const allOf = (predicates: ReadonlyArray<SubsetPredicate>): SubsetPredicate | undefined => {
  const [only, ...others] = predicates;
  return others.length === 0 ? only : { _tag: "and", predicates };
};

const pageSpec = <Column extends string>(
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

const summarySpec = (
  source: ListSource,
  where: SubsetPredicate | undefined,
): InventorySubsetSummarySpec =>
  where ? { source, where, distinct: [] } : { source, distinct: [] };

export const readPageIds = <Column extends string, Row extends { readonly id: string }, E>(
  reader: ReplicaSubsetReader,
  source: ListSource,
  where: SubsetPredicate | undefined,
  page: ListPage<Column>,
  decodeRows: (rows: ReadonlyArray<ReplicaRow>) => Effect.Effect<ReadonlyArray<Row>, E>,
  failure: () => WorkspaceReadFailure,
): Effect.Effect<ReadonlyArray<Row["id"]>, WorkspaceReadFailure> =>
  Effect.tryPromise({
    try: () => reader.readSubset(pageSpec(source, where, page)),
    catch: failure,
  }).pipe(
    Effect.flatMap((read) => decodeRows(read.rows)),
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
