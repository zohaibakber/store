import type { LoadSubsetOptions } from "@tanstack/db";
import * as Effect from "effect/Effect";

import { analyzeInventorySubset } from "./subset-ir";
import type {
  InventoryCollectionDescriptor,
  InventoryCollectionRow,
  ReplicaQueryStamp,
  SqliteCollectionDependencies,
} from "./types";

export type PlannedRead<Row extends InventoryCollectionRow> = {
  readonly stamp: ReplicaQueryStamp;
  readonly rows: ReadonlyArray<Row>;
};

export const readCollectionSubset = async <Row extends InventoryCollectionRow>(
  descriptor: InventoryCollectionDescriptor<Row>,
  dependencies: SqliteCollectionDependencies,
  options: LoadSubsetOptions,
): Promise<PlannedRead<Row>> => {
  const spec = Effect.runSync(analyzeInventorySubset(descriptor, options));
  const read = await dependencies.executor.readSubset(spec);
  return { stamp: read.stamp, rows: Effect.runSync(descriptor.decodeRows(read.rows)) };
};
