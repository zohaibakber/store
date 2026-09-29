// @vitest-environment happy-dom
import { createCollection, DbClient, DbProvider, useLiveSuspenseQuery } from "@tanstack/react-db";
import { cleanup, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

interface InvoiceRow {
  readonly id: string;
  readonly createdAt: number;
}

const rows: ReadonlyArray<InvoiceRow> = [
  { id: "a", createdAt: 3 },
  { id: "b", createdAt: 2 },
  { id: "c", createdAt: 1 },
];

const onDemandInvoices = () =>
  createCollection<InvoiceRow, string>({
    id: "invoices",
    getKey: (row) => row.id,
    syncMode: "on-demand",
    sync: {
      sync: ({ begin, write, commit, markReady, collection }) => {
        markReady();
        return {
          loadSubset: () =>
            new Promise<void>((resolve) => {
              setTimeout(() => {
                begin();
                for (const row of rows) {
                  if (!collection.has(row.id)) write({ type: "insert", value: row });
                }
                void commit();
                resolve();
              }, 1);
            }),
        };
      },
    },
  });

describe("useLiveSuspenseQuery over an on-demand collection", () => {
  it("releases the boundary once an ordered, limited query loads asynchronously", async () => {
    const invoices = onDemandInvoices();
    let renders = 0;
    const Invoices = () => {
      renders += 1;
      const { data } = useLiveSuspenseQuery({
        query: (query) =>
          query
            .from({ invoice: invoices })
            .orderBy(({ invoice }) => invoice.createdAt, "desc")
            .limit(51),
      });
      return <p>{data.map((invoice) => invoice.id).join(",")}</p>;
    };

    render(
      <DbProvider client={new DbClient()}>
        <Suspense fallback={<p>loading</p>}>
          <Invoices />
        </Suspense>
      </DbProvider>,
    );

    expect(await screen.findByText("a,b,c", undefined, { timeout: 2_000 })).toBeTruthy();
    expect(renders).toBeLessThan(10);
  });
});
