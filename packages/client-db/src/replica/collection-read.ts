import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";

import type { InventoryCollectionSource } from "./sources";
import type { InventorySubsetSpec, SubsetPredicate } from "./subset-spec";
import type { ReplicaQueryStamp, ReplicaRow, ReplicaSubsetRead } from "./types";

export type ReadSubset = (spec: InventorySubsetSpec) => Effect.Effect<ReplicaSubsetRead, unknown>;

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
