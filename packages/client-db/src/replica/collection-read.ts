import type { LoadSubsetOptions } from "@tanstack/db";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";

import { MAX_IN_VALUES, type InventoryCollectionSource } from "./sources";
import { planInventoryRead } from "./subset-ir";
import type { InventorySubsetSpec, SubsetPredicate } from "./subset-spec";
import type {
  InventoryCollectionDescriptor,
  InventoryCollectionRow,
  ReplicaQueryStamp,
  ReplicaSubsetRead,
  ReplicaSubsetReader,
  SqliteCollectionDependencies,
  SqliteResultRow,
} from "./types";

export type PlannedRead<Row extends InventoryCollectionRow> = {
  readonly stamp: ReplicaQueryStamp;
  readonly rows: ReadonlyArray<Row>;
};

const afterKey = (where: SubsetPredicate | undefined, after: string | undefined) => {
  if (after === undefined) return where;
  const cursor: SubsetPredicate = { _tag: "compare", column: "id", op: "gt", value: after };
  return where ? { _tag: "and" as const, predicates: [where, cursor] } : cursor;
};

export const drainSubset = async (
  reader: ReplicaSubsetReader,
  source: InventoryCollectionSource,
  where: SubsetPredicate | undefined,
  pageRows: number,
): Promise<ReplicaSubsetRead> => {
  const rows: Array<SqliteResultRow> = [];
  let stamp: ReplicaQueryStamp | undefined;
  let after: string | undefined;
  for (;;) {
    const pageWhere = afterKey(where, after);
    const spec: InventorySubsetSpec = {
      source,
      orderBy: [{ column: "id", direction: "asc" }],
      limit: pageRows,
      offset: 0,
    };
    const page = await reader.readSubset(pageWhere ? { ...spec, where: pageWhere } : spec);
    if (
      stamp !== undefined &&
      (page.stamp.generationId !== stamp.generationId ||
        page.stamp.workspaceToken !== stamp.workspaceToken)
    ) {
      rows.length = 0;
      stamp = undefined;
      after = undefined;
      continue;
    }
    stamp ??= page.stamp;
    rows.push(...page.rows);
    const last = page.rows.at(-1)?.["id"];
    if (page.rows.length < pageRows || !Predicate.isString(last)) return { stamp, rows };
    after = last;
  }
};

const decoded = <Row extends InventoryCollectionRow>(
  descriptor: InventoryCollectionDescriptor<Row>,
  read: ReplicaSubsetRead,
): PlannedRead<Row> => ({
  stamp: read.stamp,
  rows: Effect.runSync(descriptor.decodeRows(read.rows)),
});

export const readCollectionSubset = async <Row extends InventoryCollectionRow>(
  descriptor: InventoryCollectionDescriptor<Row>,
  dependencies: SqliteCollectionDependencies,
  options: LoadSubsetOptions,
): Promise<PlannedRead<Row>> => {
  const plan = Effect.runSync(planInventoryRead(descriptor, options));
  const read =
    plan._tag === "window"
      ? await dependencies.executor.readSubset(plan.spec)
      : await drainSubset(
          dependencies.executor,
          descriptor.source,
          plan.where,
          descriptor.maximumRows,
        );
  return decoded(descriptor, read);
};

export const readCollectionSource = async <Row extends InventoryCollectionRow>(
  descriptor: InventoryCollectionDescriptor<Row>,
  dependencies: SqliteCollectionDependencies,
): Promise<PlannedRead<Row>> =>
  decoded(
    descriptor,
    await drainSubset(dependencies.executor, descriptor.source, undefined, descriptor.maximumRows),
  );

export const readCollectionKeys = async <Row extends InventoryCollectionRow>(
  descriptor: InventoryCollectionDescriptor<Row>,
  dependencies: SqliteCollectionDependencies,
  keys: ReadonlyArray<string>,
): Promise<ReadonlyArray<PlannedRead<Row>>> => {
  const reads: Array<Promise<ReplicaSubsetRead>> = [];
  for (let start = 0; start < keys.length; start += MAX_IN_VALUES) {
    const values = keys.slice(start, start + MAX_IN_VALUES);
    reads.push(
      drainSubset(
        dependencies.executor,
        descriptor.source,
        { _tag: "in", column: "id", values },
        descriptor.maximumRows,
      ),
    );
  }
  return (await Promise.all(reads)).map((read) => decoded(descriptor, read));
};
