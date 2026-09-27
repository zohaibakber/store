import type { SyncConfig } from "@tanstack/db";
import * as Schema from "effect/Schema";

import type { InventoryCollectionRow } from "./types";

const jsonEquivalence = Schema.toEquivalence(Schema.Json);

const toJson = Schema.decodeUnknownSync(Schema.Json);

const rowEquivalence = (previous: InventoryCollectionRow, next: InventoryCollectionRow): boolean =>
  jsonEquivalence(toJson(previous), toJson(next));

type SyncParams<Row extends InventoryCollectionRow> = Parameters<
  SyncConfig<Row, string>["sync"]
>[0];

export const incrementRowRef = (counts: Map<string, number>, key: string): void => {
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

export const decrementRowRef = (counts: Map<string, number>, key: string): number => {
  const next = (counts.get(key) ?? 0) - 1;
  if (next <= 0) {
    counts.delete(key);
    return 0;
  }
  counts.set(key, next);
  return next;
};

const rowUnchanged = <Row extends InventoryCollectionRow>(previous: Row, next: Row): boolean =>
  previous === next || rowEquivalence(previous, next);

export const publishSubsetWindow = <Row extends InventoryCollectionRow>(
  params: SyncParams<Row>,
  descriptor: { readonly getKey: (row: Row) => string },
  previousKeys: ReadonlySet<string>,
  previousRows: Map<string, Row>,
  nextRows: ReadonlyArray<Row>,
  rowRefs: Map<string, number>,
  signal?: AbortSignal,
) => {
  const nextKeys = new Set<string>();
  const nextByKey = new Map<string, Row>();
  for (const row of nextRows) {
    const key = descriptor.getKey(row);
    nextKeys.add(key);
    nextByKey.set(key, row);
  }

  params.begin();
  for (const key of nextKeys) {
    const row = nextByKey.get(key);
    if (row === undefined) continue;
    const existed = rowRefs.has(key);
    const previous = previousRows.get(key);
    incrementRowRef(rowRefs, key);
    if (previousKeys.has(key)) decrementRowRef(rowRefs, key);
    if (existed && previous !== undefined && rowUnchanged(previous, row)) {
      nextByKey.set(key, previous);
      continue;
    }
    params.write({ type: existed ? "update" : "insert", value: row });
  }
  for (const key of previousKeys) {
    if (nextKeys.has(key)) continue;
    if (decrementRowRef(rowRefs, key) === 0) params.write({ type: "delete", key });
  }
  return { keys: nextKeys, rows: nextByKey, receipt: params.commit(signal) };
};
