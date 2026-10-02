import * as Schema from "effect/Schema";

export const SavePdfOutcome = Schema.Union([
  Schema.TaggedStruct("saved", { fileName: Schema.String }),
  Schema.TaggedStruct("printed", {}),
  Schema.TaggedStruct("cancelled", {}),
  Schema.TaggedStruct("failed", { message: Schema.String }),
]);
export type SavePdfOutcome = typeof SavePdfOutcome.Type;

export type ShareBridge = {
  readonly openExternal: (url: string) => Promise<void>;
  readonly copyText: (text: string) => Promise<void>;
  readonly savePdf: (fileStem: string) => Promise<SavePdfOutcome>;
};

const decodeSavePdfOutcome = Schema.decodeUnknownSync(SavePdfOutcome);

export const decodedShareBridge = (bridge: ShareBridge): ShareBridge => ({
  openExternal: (url) => bridge.openExternal(url),
  copyText: (text) => bridge.copyText(text),
  savePdf: async (fileStem) => decodeSavePdfOutcome(await bridge.savePdf(fileStem)),
});
