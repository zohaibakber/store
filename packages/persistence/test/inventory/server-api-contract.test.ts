import { InvoiceExtraction } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, test } from "vitest";

describe("server API response contracts", () => {
  test("decodes a valid invoice extraction", () => {
    const payload = {
      supplier: "Acme Medical",
      invoiceNumber: "INV-42",
      lines: [
        {
          name: "Paracetamol",
          batchNumber: "B-100",
          expiresAt: "2027-12-31",
          packQuantity: 4,
          unitQuantity: 2,
          unitsPerPack: 10,
          packPrice: 1250,
        },
      ],
    };

    const decoded = Effect.runSync(Schema.decodeUnknownEffect(InvoiceExtraction)(payload));

    expect(decoded).toEqual(payload);
  });

  test("rejects an invoice extraction without lines", () => {
    const exit = Effect.runSyncExit(
      Schema.decodeUnknownEffect(InvoiceExtraction)({
        supplier: null,
        invoiceNumber: null,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
