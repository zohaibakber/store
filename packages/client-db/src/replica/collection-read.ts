import type { LoadSubsetOptions } from "@tanstack/db";
import * as Effect from "effect/Effect";

import { analyzeInventorySubset, compileSqliteSubset } from "./compile";
import { planIndexedDbSubset } from "./indexeddb-plan";
import {
  isReplicaIndexedDbExecutor,
  type InventoryCollectionDescriptor,
  type InventoryCollectionRow,
  type ReplicaQueryStamp,
  type ReplicaSubsetRead,
  type SqliteCollectionDependencies,
  type SqliteSubsetPlan,
} from "./types";

export type PlannedRead<Row extends InventoryCollectionRow> = {
  readonly stamp: ReplicaQueryStamp;
  readonly rows: ReadonlyArray<Row>;
};

export const decodeSubsetRead = <Row extends InventoryCollectionRow>(
  descriptor: InventoryCollectionDescriptor<Row>,
  read: ReplicaSubsetRead,
): PlannedRead<Row> => ({
  stamp: read.stamp,
  rows: Effect.runSync(descriptor.decodeRows(read.rows)),
});

export const readSqlPlan = async <Row extends InventoryCollectionRow>(
  descriptor: InventoryCollectionDescriptor<Row>,
  dependencies: SqliteCollectionDependencies,
  plan: Pick<SqliteSubsetPlan, "sql" | "parameters">,
): Promise<PlannedRead<Row>> => {
  const executor = dependencies.executor;
  if (isReplicaIndexedDbExecutor(executor)) {
    throw new Error("IndexedDB executor cannot run SQL subset plans.");
  }
  if (executor.queryStamped) {
    return decodeSubsetRead(descriptor, await executor.queryStamped(plan.sql, plan.parameters));
  }
  const stamp = await executor.stamp();
  const rows = await executor.query(plan.sql, plan.parameters);
  return decodeSubsetRead(descriptor, { stamp, rows });
};

export const readCollectionSubset = async <Row extends InventoryCollectionRow>(
  descriptor: InventoryCollectionDescriptor<Row>,
  dependencies: SqliteCollectionDependencies,
  options: LoadSubsetOptions,
): Promise<PlannedRead<Row>> => {
  if (isReplicaIndexedDbExecutor(dependencies.executor)) {
    const spec = Effect.runSync(analyzeInventorySubset(descriptor, options));
    const plan = Effect.runSync(planIndexedDbSubset(spec));
    return decodeSubsetRead(descriptor, await dependencies.executor.querySubset(plan));
  }
  const plan = Effect.runSync(compileSqliteSubset(descriptor, options));
  return readSqlPlan(descriptor, dependencies, plan);
};
