import * as Schema from "effect/Schema";

export const SavePdfOutcome = Schema.Union([
  Schema.TaggedStruct("saved", { fileName: Schema.String }),
  Schema.TaggedStruct("printed", {}),
  Schema.TaggedStruct("cancelled", {}),
  Schema.TaggedStruct("failed", { message: Schema.String }),
]);
export type SavePdfOutcome = typeof SavePdfOutcome.Type;

export const ROLL_WIDTHS_MM = [58, 80] as const;

export const PrintPage = Schema.Union([
  Schema.TaggedStruct("A4", {}),
  Schema.TaggedStruct("Roll", {
    widthMm: Schema.Literals(ROLL_WIDTHS_MM),
    heightMm: Schema.Int.check(Schema.isBetween({ minimum: 20, maximum: 5000 })),
  }),
]);
export type PrintPage = typeof PrintPage.Type;

export const PrintOutcome = Schema.Union([
  Schema.TaggedStruct("printed", {}),
  Schema.TaggedStruct("cancelled", {}),
  Schema.TaggedStruct("failed", { message: Schema.String }),
]);
export type PrintOutcome = typeof PrintOutcome.Type;
