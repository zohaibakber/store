import { createCollection, createLiveQueryCollection } from "@tanstack/db";
import * as Effect from "effect/Effect";
import { describe, expect, it, vi } from "vitest";

import { sqliteCollectionOptions } from "../src/replica/collection";
import { decodeInvoiceSqliteRows } from "../src/replica/decode";
import { openNodeReplicaSqlite } from "../src/replica/node-sqlite";
import type { InvoiceRow } from "../src/rows";

const identity = { organizationId: "org-1", userId: "user-1", replicaId: "replica-1" };

type NodeReplica = Awaited<ReturnType<typeof openNodeReplicaSqlite>>;

const insertInvoice = (number: number) =>
  Effect.fn("test.insertInvoice")(function* (
    handle: Parameters<Parameters<NodeReplica["withWrite"]>[0]>[0],
  ) {
    yield* handle.sql.unsafe(
      `insert into invoices (
        id, invoiceNumber, customerName, total, createdAt, updatedAt,
        organizationId, createdByUserId, updatedByUserId, deviceId, operationId, rowVersion
      ) values (?, ?, null, 100, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        `inv-${number}`,
        number,
        number,
        number,
        identity.organizationId,
        identity.userId,
        identity.userId,
        identity.replicaId,
        `op-${number}`,
      ],
    );
  });

const deleteInvoice = (number: number) =>
  Effect.fn("test.deleteInvoice")(function* (
    handle: Parameters<Parameters<NodeReplica["withWrite"]>[0]>[0],
  ) {
    yield* handle.sql.unsafe(`delete from invoices where id = ?`, [`inv-${number}`]);
  });

describe("ordered limited invoice windows", () => {
  it("refills the window after a shown row is deleted and after a truncate replay", async () => {
    const replica = await openNodeReplicaSqlite(identity);
    for (const number of [1, 2, 3, 4, 5, 6, 7, 8]) {
      await replica.withWrite(insertInvoice(number), ["invoice"], [`inv-${number}`]);
    }
    const invoices = createCollection(
      sqliteCollectionOptions<InvoiceRow>(
        {
          id: "test:invoices",
          source: "invoices",
          syncMode: "on-demand",
          maximumRows: 3,
          getKey: (row) => row.id,
          decodeRows: decodeInvoiceSqliteRows,
        },
        { executor: replica, changeFeed: replica },
      ),
    );
    const recent = createLiveQueryCollection((query) =>
      query
        .from({ invoice: invoices })
        .orderBy(({ invoice }) => invoice.createdAt, "desc")
        .limit(3)
        .select(({ invoice }) => ({ number: invoice.invoiceNumber })),
    );
    const shown = () => recent.toArray.map((row) => row.number);
    await recent.preload();
    expect(shown()).toEqual([8, 7, 6]);

    await replica.withWrite(deleteInvoice(7), ["invoice"], ["inv-7"]);
    await vi.waitFor(() => expect(shown()).toEqual([8, 6, 5]));

    await replica.withWrite(insertInvoice(9), ["invoice"], ["inv-9"]);
    await vi.waitFor(() => expect(shown()).toEqual([9, 8, 6]));

    await replica.withWrite(
      (handle) =>
        deleteInvoice(9)(handle).pipe(
          Effect.andThen(
            handle.sql.unsafe(
              `update replica_state set activeGeneration = activeGeneration + 1 where id = 'singleton'`,
            ),
          ),
          Effect.asVoid,
        ),
      ["invoice"],
      ["inv-9"],
    );
    await vi.waitFor(() => expect(shown()).toEqual([8, 6, 5]));
    expect(recent.utils.lastSubsetError).toBeUndefined();
    replica.close();
  });
});
