import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ROLL_WIDTHS_MM } from "@/host/share";

export const RECEIPT_PAPERS = ["a4", "thermal"] as const;

export const ReceiptPaper = Schema.Literals(RECEIPT_PAPERS);
export type ReceiptPaper = typeof ReceiptPaper.Type;

export const RollWidth = Schema.Literals(ROLL_WIDTHS_MM);
export type RollWidth = typeof RollWidth.Type;

export const RECEIPT_TEXT_LIMITS = {
  storeName: 60,
  phone: 40,
  address: 160,
  registration: 160,
  footer: 200,
} as const;

const DEFAULT_FOOTER = "Thank you for your purchase.";

const defaulting = <S extends Schema.Top>(schema: S, value: S["Type"]) =>
  schema.pipe(Schema.withDecodingDefaultKey(Effect.succeed(value)));

export const ReceiptFormat = Schema.Struct({
  storeName: defaulting(Schema.String, ""),
  phone: defaulting(Schema.String, ""),
  address: defaulting(Schema.String, ""),
  registration: defaulting(Schema.String, ""),
  footer: defaulting(Schema.String, DEFAULT_FOOTER),
  paper: defaulting(ReceiptPaper, "a4"),
  rollWidth: defaulting(RollWidth, 80),
  showBatch: defaulting(Schema.Boolean, true),
  printAfterSale: defaulting(Schema.Boolean, false),
});
export type ReceiptFormat = typeof ReceiptFormat.Type;

export const DEFAULT_RECEIPT_FORMAT: ReceiptFormat = Schema.decodeUnknownSync(ReceiptFormat)({});

export const receiptStoreName = (
  format: Pick<ReceiptFormat, "storeName">,
  organizationName: string | null,
): string | null => format.storeName.trim() || organizationName;
