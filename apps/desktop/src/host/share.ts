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

export type ShareBridge = {
  readonly openExternal: (url: string) => Promise<void>;
  readonly copyText: (text: string) => Promise<void>;
  readonly savePdf: (fileStem: string) => Promise<SavePdfOutcome>;
  readonly print: (page: PrintPage) => Promise<PrintOutcome>;
};

const decodeSavePdfOutcome = Schema.decodeUnknownSync(SavePdfOutcome);
const decodePrintOutcome = Schema.decodeUnknownSync(PrintOutcome);

export const decodedShareBridge = (bridge: ShareBridge): ShareBridge => ({
  openExternal: (url) => bridge.openExternal(url),
  copyText: (text) => bridge.copyText(text),
  savePdf: async (fileStem) => decodeSavePdfOutcome(await bridge.savePdf(fileStem)),
  print: async (page) => decodePrintOutcome(await bridge.print(page)),
});
