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
} from "./types";

export type PlannedRead<Row extends InventoryCollectionRow> = {
  readonly stamp: ReplicaQueryStamp;
  readonly rows: ReadonlyArray<Row>;
};

export type ReadSubset = (spec: InventorySubsetSpec) => Effect.Effect<ReplicaSubsetRead, unknown>;

export const interruptibleReads =
  (reader: ReplicaSubsetReader): ReadSubset =>
  (spec) =>
    Effect.tryPromise({
      try: (signal) => reader.readSubset(spec, { signal }),
      catch: (cause) => cause,
    });

const afterKey = (where: SubsetPredicate | undefined, after: string | undefined) => {
  if (after === undefined) return where;
  const cursor: SubsetPredicate = { _tag: "compare", column: "id", op: "gt", value: after };
  return where ? { _tag: "and" as const, predicates: [where, cursor] } : cursor;
};

export const drainSubset = Effect.fnUntraced(function* (
  read: ReadSubset,
  source: InventoryCollectionSource,
  where: SubsetPredicate | undefined,
  pageRows: number,
) {
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
    const page = yield* read(pageWhere ? { ...spec, where: pageWhere } : spec);
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
    if (page.rows.length < pageRows || !Predicate.isString(last)) {
      return { stamp, rows } satisfies ReplicaSubsetRead;
    }
    after = last;
  }
});

const decoded = <Row extends InventoryCollectionRow>(
  descriptor: InventoryCollectionDescriptor<Row>,
  read: ReplicaSubsetRead,
): Effect.Effect<PlannedRead<Row>, unknown> =>
  Effect.map(descriptor.decodeRows(read.rows), (rows) => ({ stamp: read.stamp, rows }));

export const readCollectionSubset = <Row extends InventoryCollectionRow>(
  descriptor: InventoryCollectionDescriptor<Row>,
  read: ReadSubset,
  options: LoadSubsetOptions,
): Effect.Effect<PlannedRead<Row>, unknown> =>
  planInventoryRead(descriptor, options).pipe(
    Effect.flatMap((plan) =>
      plan._tag === "window"
        ? read(plan.spec)
        : drainSubset(read, descriptor.source, plan.where, descriptor.maximumRows),
    ),
    Effect.flatMap((subset) => decoded(descriptor, subset)),
  );

export const readCollectionSource = <Row extends InventoryCollectionRow>(
  descriptor: InventoryCollectionDescriptor<Row>,
  read: ReadSubset,
): Effect.Effect<PlannedRead<Row>, unknown> =>
  drainSubset(read, descriptor.source, undefined, descriptor.maximumRows).pipe(
    Effect.flatMap((subset) => decoded(descriptor, subset)),
  );
