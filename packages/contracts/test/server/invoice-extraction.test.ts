import { expect, test } from "vitest";

import {
  invoiceExtractionJsonSchema,
  invoiceUploadRejection,
  MAX_INVOICE_UPLOAD_BYTES,
  MAX_INVOICE_UPLOAD_FILES,
} from "../../src/server/schema";

test("derives the model JSON schema from the transport contract", () => {
  expect(invoiceExtractionJsonSchema).toMatchObject({
    type: "object",
    required: ["supplier", "invoiceNumber", "lines"],
  });
});

test.each([
  [[], "Attach at least one invoice file."],
  [
    Array.from({ length: MAX_INVOICE_UPLOAD_FILES + 1 }, () => ({ byteLength: 1 })),
    `Attach at most ${MAX_INVOICE_UPLOAD_FILES} invoice files.`,
  ],
  [[{ byteLength: MAX_INVOICE_UPLOAD_BYTES + 1 }], "The attachments are too large."],
  [[{ byteLength: 1 }, { byteLength: 1 }], null],
])("invoice upload limits for %#", (files, expected) => {
  expect(invoiceUploadRejection(files)).toBe(expected);
});
