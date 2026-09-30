import { createCollection, createLiveQueryCollection } from "@tanstack/db";
import * as Effect from "effect/Effect";
import { describe, expect, it, vi } from "vitest";

import { sqliteCollectionOptions } from "../src/replica/collection";
import { decodeCategorySqliteRows, decodeInvoiceSqliteRows } from "../src/replica/decode";
import { openNodeReplicaSqlite } from "../src/replica/node-sqlite";
import type { InventorySubsetSpec } from "../src/replica/subset-spec";
import type { InventoryCollectionDescriptor, ReplicaCommitNotice } from "../src/replica/types";
import type { CategoryRow, InvoiceRow } from "../src/rows";

const stamp = { workspaceToken: "w", generationId: "1" };

const notice = (
  version: number,
  extra: Partial<ReplicaCommitNotice> = {},
): ReplicaCommitNotice => ({
  ...stamp,
  localCommitVersion: version,
  touchedEntities: ["category"],
  touchedKeys: [],
  ...extra,
});

const feed = () => {
  const listeners = new Set<(n: ReplicaCommitNotice) => void>();
  return {
    listeners,
    subscribe: (l: (n: ReplicaCommitNotice) => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    emit: (n: ReplicaCommitNotice) => {
      for (const l of listeners) l(n);
    },
  };
};

const descriptor: InventoryCollectionDescriptor<CategoryRow> = {
  id: "t:c",
  source: "categories",
  syncMode: "on-demand",
  maximumRows: 500,
  getKey: (r) => r.id,
  decodeRows: decodeCategorySqliteRows,
};

describe("demand", () => {
  it("full invalidation marker refreshes a collection whose entity was not listed", async () => {
    const f = feed();
    const reads = vi.fn(async () => ({ stamp: { ...stamp, localCommitVersion: 1 }, rows: [] }));
    const collection = createCollection(
      sqliteCollectionOptions(descriptor, { executor: { readSubset: reads }, changeFeed: f }),
    );
    collection.subscribeChanges(() => undefined, { includeInitialState: true });
    await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(1));
    f.emit(notice(2, { touchedEntities: ["product"] }));
    await new Promise((r) => setTimeout(r, 30));
    expect(reads).toHaveBeenCalledTimes(1);
    f.emit(Object.assign(notice(3, { touchedEntities: [] }), { fullInvalidation: true }));
    await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(2));
  });
});

describe("windows", () => {
  const identity = { organizationId: "org-1", userId: "user-1", replicaId: "replica-1" };
  type NodeReplica = Awaited<ReturnType<typeof openNodeReplicaSqlite>>;
  const insert = (n: number) => (handle: Parameters<Parameters<NodeReplica["withWrite"]>[0]>[0]) =>
    handle.sql
      .unsafe(
        `insert into invoices (id, invoiceNumber, customerName, total, createdAt, updatedAt, organizationId, createdByUserId, updatedByUserId, deviceId, operationId, rowVersion) values (?, ?, null, 100, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          `inv-${n}`,
          n,
          n,
          n,
          identity.organizationId,
          identity.userId,
          identity.userId,
          identity.replicaId,
          `op-${n}`,
        ],
      )
      .pipe(Effect.asVoid);
  const del = (n: number) => (handle: Parameters<Parameters<NodeReplica["withWrite"]>[0]>[0]) =>
    handle.sql.unsafe(`delete from invoices where id = ?`, [`inv-${n}`]).pipe(Effect.asVoid);

  const drains = (specs: ReadonlyArray<InventorySubsetSpec>) =>
    specs.filter(
      (sp) =>
        sp.orderBy[0]?.column === "id" &&
        (sp.where === undefined ||
          (sp.where._tag === "compare" && sp.where.column === "id" && sp.where.op === "gt")),
    );

  const recording = async () => {
    const specs: Array<InventorySubsetSpec> = [];
    let rowsRead = 0;
    const replica = await openNodeReplicaSqlite(identity);
    for (let n = 1; n <= 8; n++)
      await replica.withWrite(insert(n), ["invoice"], [`invoice:inv-${n}`]);
    const invoices = createCollection(
      sqliteCollectionOptions<InvoiceRow>(
        {
          id: "t:inv",
          source: "invoices",
          syncMode: "on-demand",
          maximumRows: 3,
          getKey: (r) => r.id,
          decodeRows: decodeInvoiceSqliteRows,
        },
        {
          executor: {
            readSubset: async (spec) => {
              specs.push(spec);
              const read = await replica.readSubset(spec);
              rowsRead += read.rows.length;
              return read;
            },
          },
          changeFeed: replica,
        },
      ),
    );
    const window = (offset: number) =>
      createLiveQueryCollection((q) =>
        q
          .from({ invoice: invoices })
          .orderBy(({ invoice }) => invoice.createdAt, "desc")
          .offset(offset)
          .limit(3)
          .select(({ invoice }) => ({ number: invoice.invoiceNumber, total: invoice.total })),
      );
    return { specs, rowsRead: () => rowsRead, replica, invoices, window };
  };

  it("releases departed rows and never reloads the source while the window slides", async () => {
    const { specs, rowsRead, replica, invoices, window } = await recording();
    const recent = window(0);
    const shown = () => recent.toArray.map((r) => r.number);
    await recent.preload();
    expect(shown()).toEqual([8, 7, 6]);
    const before = rowsRead();
    const last = 58;
    let largest = invoices.size;
    for (let n = 9; n <= last; n++) {
      await replica.withWrite(insert(n), ["invoice"], [`invoice:inv-${n}`]);
      if (n % 7 === 0) await new Promise((r) => setTimeout(r, 0));
      largest = Math.max(largest, invoices.size);
    }
    await vi.waitFor(() => expect(shown()).toEqual([last, last - 1, last - 2]));
    expect(largest).toBeLessThanOrEqual(3 + 2);
    await vi.waitFor(() => expect(invoices.size).toBe(3));
    expect(rowsRead() - before).toBeLessThanOrEqual((last - 8) * 4);
    expect(drains(specs)).toEqual([]);
    await replica.withWrite(del(last), ["invoice"], [`invoice:inv-${last}`]);
    await vi.waitFor(() => expect(shown()).toEqual([last - 1, last - 2, last - 3]));
    expect(invoices.size).toBeLessThanOrEqual(3 + 1);
    expect(drains(specs)).toEqual([]);
    await recent.cleanup();
    await vi.waitFor(() => expect(invoices.size).toBe(0));
    await replica.close();
  });
});
