import type { LoadSubsetOptions } from "@tanstack/db";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";

import type { InventoryCollectionSource } from "./sources";
import { planInventoryRead } from "./subset-ir";
import type { InventorySubsetSpec, SubsetPredicate } from "./subset-spec";
import type {
  InventoryCollectionDescriptor,
  InventoryCollectionRow,
  ReplicaQueryStamp,
  ReplicaRow,
  ReplicaSubsetRead,
  ReplicaSubsetReader,
  SqliteCollectionDependencies,
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
  signal?: AbortSignal,
): Promise<ReplicaSubsetRead> => {
  const rows: Array<ReplicaRow> = [];
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
    const page = await reader.readSubset(
      pageWhere ? { ...spec, where: pageWhere } : spec,
      signal === undefined ? undefined : { signal },
    );
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
  signal?: AbortSignal,
): Promise<PlannedRead<Row>> => {
  const plan = Effect.runSync(planInventoryRead(descriptor, options));
  const read =
    plan._tag === "window"
      ? await dependencies.executor.readSubset(
          plan.spec,
          signal === undefined ? undefined : { signal },
        )
      : await drainSubset(
          dependencies.executor,
          descriptor.source,
          plan.where,
          descriptor.maximumRows,
          signal,
        );
  return decoded(descriptor, read);
};

export const readCollectionSource = async <Row extends InventoryCollectionRow>(
  descriptor: InventoryCollectionDescriptor<Row>,
  dependencies: SqliteCollectionDependencies,
  signal?: AbortSignal,
): Promise<PlannedRead<Row>> =>
  decoded(
    descriptor,
    await drainSubset(
      dependencies.executor,
      descriptor.source,
      undefined,
      descriptor.maximumRows,
      signal,
    ),
  );
