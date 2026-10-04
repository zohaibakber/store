import { extractInvoice, type InvoiceAiClient } from "@store/services";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

const csv = (name: string, product: string) =>
  new File([`name,packs,units per pack\n${product},2,10\n`], name, { type: "text/csv" });

const pdf = (name: string) => new File(["%PDF"], name, { type: "application/pdf" });

const fakeAi = () => {
  const converted: Array<string> = [];
  const ai: InvoiceAiClient = {
    toMarkdown: (documents) =>
      Effect.sync(() => {
        converted.push(...documents.map((document) => document.name));
        return documents.map((document) => ({
          kind: "ok" as const,
          name: document.name,
          data: `invoice text of ${document.name}`,
        }));
      }),
    generate: () =>
      Effect.succeed({
        supplier: "Acme Pharma",
        invoiceNumber: "INV-7",
        lines: [{ name: "Printed product", packQuantity: 3, unitQuantity: 0, unitsPerPack: 5 }],
      }),
  };
  return { ai, converted };
};

const names = (extraction: { readonly lines: ReadonlyArray<{ readonly name: string }> }) =>
  extraction.lines.map((line) => line.name);

describe("extractInvoice", () => {
  it("keeps the PDF lines of a mixed upload beside the CSV lines, in file order", async () => {
    const { ai, converted } = fakeAi();
    const extraction = await Effect.runPromise(
      extractInvoice(ai, [csv("a.csv", "First"), pdf("b.pdf"), csv("c.csv", "Last"), pdf("d.pdf")]),
    );
    expect(extraction).toMatchObject({ supplier: "Acme Pharma", invoiceNumber: "INV-7" });
    expect(names(extraction)).toEqual(["First", "Printed product", "Last"]);
    expect(converted).toEqual(["b.pdf", "d.pdf"]);
  });
});
