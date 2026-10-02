import type { InvoiceExtraction } from "@store/contracts/server-api.schema";

export const SERVER_UPLOADS_CHANNEL = "server:uploads";

export type ServerApiIpcBridge = {
  readonly analyseInvoices: (input: {
    files: Array<{ name: string; type: string; bytes: ArrayBuffer }>;
  }) => Promise<InvoiceExtraction>;
};
