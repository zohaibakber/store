import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, test } from "vitest";

import {
  InvoiceExtraction,
  invoiceExtractionJsonSchema,
  invoiceUploadRejection,
  MAX_INVOICE_UPLOAD_BYTES,
  MAX_INVOICE_UPLOAD_FILES,
} from "../../src/server/schema";

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

  test("derives the model JSON schema from the transport contract", () => {
    expect(invoiceExtractionJsonSchema).toMatchObject({
      type: "object",
      required: ["supplier", "invoiceNumber", "lines"],
    });
  });
});

describe("invoice upload limits", () => {
  test("rejects an empty file list", () => {
    expect(invoiceUploadRejection([])).toBe("Attach at least one invoice file.");
  });

  test("rejects more files than the server accepts", () => {
    const files = Array.from({ length: MAX_INVOICE_UPLOAD_FILES + 1 }, () => ({ byteLength: 1 }));
    expect(invoiceUploadRejection(files)).toBe(
      `Attach at most ${MAX_INVOICE_UPLOAD_FILES} invoice files.`,
    );
  });

  test("rejects a payload over the total byte cap", () => {
    expect(invoiceUploadRejection([{ byteLength: MAX_INVOICE_UPLOAD_BYTES + 1 }])).toBe(
      "The attachments are too large.",
    );
  });

  test("accepts a payload within both caps", () => {
    expect(invoiceUploadRejection([{ byteLength: 1 }, { byteLength: 1 }])).toBeNull();
  });
});
