import { IR, createCollection, createLiveQueryCollection, eq } from "@tanstack/db";
import * as Effect from "effect/Effect";
import { describe, expect, it, vi } from "vitest";

import { sqliteCollectionOptions } from "../src/replica/collection";
import {
  accumulateNotice,
  NOTICE_KEYS_PER_ENTITY,
  invalidatedEntities,
} from "../src/replica/collection-notices";
import type { PlannedRead } from "../src/replica/collection-read";
import { startCollectionSync } from "../src/replica/collection-sync";
import { decodeCategorySqliteRows, decodeInvoiceSqliteRows } from "../src/replica/decode";
import { openNodeReplicaSqlite } from "../src/replica/node-sqlite";
import type { InventorySubsetSpec } from "../src/replica/subset-spec";
import type {
  InventoryCollectionDescriptor,
  ReplicaCommitNotice,
  ReplicaSubsetReader,
} from "../src/replica/types";
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

type SyncParams = Parameters<
  NonNullable<ReturnType<typeof sqliteCollectionOptions<CategoryRow>>["sync"]>["sync"]
>[0];

const paramsMock = () => {
  const calls: Array<string> = [];
  const captured: Array<SyncParams> = [];
  createCollection<CategoryRow, string>({
    id: "t:capture",
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      sync: (params) => {
        captured.push(params);
        params.markReady();
      },
    },
  });
  const [real] = captured;
  if (real === undefined) throw new Error("sync was not started");
  return {
    calls,
    params: {
      ...real,
      begin: () => {
        calls.push("begin");
        real.begin();
      },
    },
  };
};

describe("accumulator", () => {
  it("bounds keys and degrades to entity invalidation", () => {
    let acc = accumulateNotice(undefined, notice(1, { touchedEntities: ["product"] }));
    for (let i = 2; i < 5000; i++) {
      acc = accumulateNotice(
        acc,
        notice(i, { touchedEntities: ["product"], touchedKeys: [`product:${i}`] }),
      );
    }
    expect(acc.keys.get("product")).toBeUndefined();
    expect([...acc.overflowed]).toEqual(["product"]);
    expect(invalidatedEntities(acc)).toEqual(["product"]);
    expect(acc.version).toBe(4999);
    acc = accumulateNotice(acc, notice(4999, { touchedEntities: ["batch"] }));
    expect(invalidatedEntities(acc)).toEqual(["product"]);
    acc = accumulateNotice(undefined, notice(1, { touchedKeys: ["category:a", "category:b"] }));
    expect(acc.keys.get("category")?.size).toBe(2);
    expect(NOTICE_KEYS_PER_ENTITY).toBeGreaterThan(2);
  });
});

describe("demand", () => {
  it("dormant does nothing; demand subscribes; release unsubscribes", async () => {
    const f = feed();
    const reads = vi.fn(async () => ({ stamp: { ...stamp, localCommitVersion: 1 }, rows: [] }));
    const collection = createCollection(
      sqliteCollectionOptions(descriptor, { executor: { readSubset: reads }, changeFeed: f }),
    );
    await collection.preload();
    expect(f.listeners.size).toBe(0);
    for (let i = 0; i < 5000; i++) f.emit(notice(i + 2));
    const sub = collection.subscribeChanges(() => undefined, {
      includeInitialState: true,
      whereExpression: new IR.Func("in", [new IR.PropRef(["id"]), new IR.Value(["x"])]),
    });
    await vi.waitFor(() => expect(reads).toHaveBeenCalled());
    expect(f.listeners.size).toBe(1);
    for (let i = 0; i < 5000; i++) f.emit(notice(i + 10000));
    await vi.waitFor(() => expect(reads.mock.calls.length).toBeGreaterThan(1));
    const settled = reads.mock.calls.length;
    expect(settled).toBeLessThan(50);
    sub.unsubscribe();
    await vi.waitFor(() => expect(f.listeners.size).toBe(0));
    const before = reads.mock.calls.length;
    for (let i = 0; i < 100; i++) f.emit(notice(i + 30000));
    await new Promise((r) => setTimeout(r, 30));
    expect(reads.mock.calls.length).toBe(before);
  });

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

  it("interrupts an obsolete subset request", async () => {
    const f = feed();
    const { params, calls } = paramsMock();
    let resolveRead: (() => void) | undefined;
    const readers = {
      subset: () =>
        new Promise<PlannedRead<CategoryRow>>((resolve) => {
          resolveRead = () => resolve({ stamp: { ...stamp, localCommitVersion: 1 }, rows: [] });
        }),
      source: async () => ({ stamp: { ...stamp, localCommitVersion: 1 }, rows: [] }),
    };
    const executor: ReplicaSubsetReader = {
      readSubset: async () => ({ stamp: { ...stamp, localCommitVersion: 1 }, rows: [] }),
    };
    const res = startCollectionSync(
      readers,
      descriptor,
      { executor, changeFeed: f },
      params,
      "category",
    );
    const controller = new AbortController();
    const p = res.loadSubset({ signal: controller.signal, limit: 5 });
    expect(f.listeners.size).toBe(1);
    controller.abort();
    await p;
    await vi.waitFor(() => expect(f.listeners.size).toBe(0));
    resolveRead?.();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.filter((c) => c === "begin")).toEqual([]);
    const opts = { limit: 5 };
    const p2 = res.loadSubset(opts);
    res.unloadSubset(opts);
    await p2;
    await vi.waitFor(() => expect(f.listeners.size).toBe(0));
    resolveRead?.();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.filter((c) => c === "begin")).toEqual([]);
    res.cleanup?.();
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

  it("retries a failed refill and still refreshes the other subsets", async () => {
    const replica = await openNodeReplicaSqlite(identity);
    const rename =
      (suffix: string) => (handle: Parameters<Parameters<NodeReplica["withWrite"]>[0]>[0]) =>
        handle.sql
          .unsafe(`update categories set name = 'Name ' || id || ?`, [suffix])
          .pipe(Effect.asVoid);
    await replica.withWrite(
      (handle) =>
        handle.sql
          .unsafe(
            `insert into categories (id, name, tracksPacks, createdAt, updatedAt, organizationId, createdByUserId, updatedByUserId, deviceId, operationId, rowVersion) values ('c-a', 'Name c-a', 1, 1, 1, ?, ?, ?, ?, 'op-a', 1), ('c-b', 'Name c-b', 1, 1, 1, ?, ?, ?, ?, 'op-b', 1)`,
            [
              identity.organizationId,
              identity.userId,
              identity.userId,
              identity.replicaId,
              identity.organizationId,
              identity.userId,
              identity.userId,
              identity.replicaId,
            ],
          )
          .pipe(Effect.asVoid),
      ["category"],
      ["category:c-a", "category:c-b"],
    );
    let failNext = false;
    let failures = 0;
    const categories = createCollection(
      sqliteCollectionOptions(
        { ...descriptor, id: "t:retry" },
        {
          executor: {
            readSubset: (spec) => {
              if (failNext && JSON.stringify(spec).includes("c-a")) {
                failNext = false;
                failures += 1;
                return Promise.reject(new Error("refill failed"));
              }
              return replica.readSubset(spec);
            },
          },
          changeFeed: replica,
        },
      ),
    );
    const named = (id: string) =>
      createLiveQueryCollection((q) =>
        q
          .from({ category: categories })
          .where(({ category }) => eq(category.id, id))
          .select(({ category }) => ({ name: category.name })),
      );
    const first = named("c-a");
    const second = named("c-b");
    await Promise.all([first.preload(), second.preload()]);
    expect(first.toArray.map((row) => row.name)).toEqual(["Name c-a"]);
    expect(second.toArray.map((row) => row.name)).toEqual(["Name c-b"]);
    failNext = true;
    await replica.withWrite(rename(" v2"), ["category"], ["category:c-a", "category:c-b"]);
    await vi.waitFor(() => {
      expect(second.toArray.map((row) => row.name)).toEqual(["Name c-b v2"]);
      expect(first.toArray.map((row) => row.name)).toEqual(["Name c-a v2"]);
    });
    expect(failures).toBe(1);
    await first.cleanup();
    await second.cleanup();
    await replica.close();
  });

  const drains = (specs: ReadonlyArray<InventorySubsetSpec>) =>
    specs.filter(
      (sp) =>
        sp.orderBy[0]?.column === "id" &&
        (sp.where === undefined ||
          (sp.where._tag === "compare" && sp.where.column === "id" && sp.where.op === "gt")),
    );

  const recording = async (maximumRows = 3) => {
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
          maximumRows,
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
    const last = 2008;
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

  it("releasing a sibling subset under a mounted window does not reload the source", async () => {
    const { specs, replica, invoices, window } = await recording();
    const recent = window(0);
    await recent.preload();
    const detail = createLiveQueryCollection((q) =>
      q
        .from({ invoice: invoices })
        .where(({ invoice }) => eq(invoice.id, "inv-2"))
        .select(({ invoice }) => ({ number: invoice.invoiceNumber })),
    );
    await detail.preload();
    expect(detail.toArray.map((r) => r.number)).toEqual([2]);
    await detail.cleanup();
    await vi.waitFor(() => expect(invoices.has("inv-2")).toBe(false));
    expect(invoices.size).toBe(3);
    await replica.withWrite(insert(9), ["invoice"], ["invoice:inv-9"]);
    await vi.waitFor(() => expect(recent.toArray.map((r) => r.number)).toEqual([9, 8, 7]));
    await vi.waitFor(() => expect(invoices.size).toBeLessThanOrEqual(3 + 1));
    expect(drains(specs)).toEqual([]);
    await recent.cleanup();
    await vi.waitFor(() => expect(invoices.size).toBe(0));
    await replica.close();
  });

  it("pages back and forward with current rows and a bounded prefix", async () => {
    const { specs, replica, invoices, window } = await recording(9);
    const paged = window(0);
    const shown = () => paged.toArray.map((r) => [r.number, r.total]);
    await paged.preload();
    for (const n of [9, 10, 11]) {
      await replica.withWrite(insert(n), ["invoice"], [`invoice:inv-${n}`]);
    }
    await vi.waitFor(() => expect(shown().map(([n]) => n)).toEqual([11, 10, 9]));
    await replica.withWrite(
      (handle) =>
        handle.sql.unsafe(`update invoices set total = 999 where id = 'inv-7'`).pipe(Effect.asVoid),
      ["invoice"],
      ["invoice:inv-7"],
    );
    await paged.utils.setWindow({ offset: 3, limit: 3 });
    await vi.waitFor(() =>
      expect(shown()).toEqual([
        [8, 100],
        [7, 999],
        [6, 100],
      ]),
    );
    await paged.utils.setWindow({ offset: 6, limit: 3 });
    await vi.waitFor(() => expect(shown().map(([n]) => n)).toEqual([5, 4, 3]));
    await replica.withWrite(insert(12), ["invoice"], ["invoice:inv-12"]);
    await vi.waitFor(() => expect(shown().map(([n]) => n)).toEqual([6, 5, 4]));
    await paged.utils.setWindow({ offset: 0, limit: 3 });
    await vi.waitFor(() => expect(shown().map(([n]) => n)).toEqual([12, 11, 10]));
    await paged.utils.setWindow({ offset: 3, limit: 3 });
    await vi.waitFor(() =>
      expect(shown()).toEqual([
        [9, 100],
        [8, 100],
        [7, 999],
      ]),
    );
    await replica.withWrite(del(8), ["invoice"], ["invoice:inv-8"]);
    await vi.waitFor(() => expect(shown().map(([n]) => n)).toEqual([9, 7, 6]));
    await paged.utils.setWindow({ offset: 6, limit: 3 });
    await vi.waitFor(() => expect(shown().map(([n]) => n)).toEqual([5, 4, 3]));
    expect(invoices.size).toBeLessThanOrEqual(6 + 3 + 2);
    await paged.utils.setWindow({ offset: 0, limit: 3 });
    await vi.waitFor(() => expect(shown().map(([n]) => n)).toEqual([12, 11, 10]));
    expect(invoices.size).toBeLessThanOrEqual(6 + 3 + 2);
    expect(drains(specs)).toEqual([]);
    await paged.cleanup();
    await vi.waitFor(() => expect(invoices.size).toBe(0));
    await replica.close();
  });
});
