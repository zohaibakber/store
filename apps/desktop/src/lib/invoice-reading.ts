import { InvoiceExtraction } from "@store/contracts/server-api.schema";
import { isCsvFile, mergeReceivedStock, receivedStockFromCsv } from "@store/services/invoice-csv";
import * as Schema from "effect/Schema";

import { useOnline } from "@/hooks/use-online";
import { appHost } from "@/host";
import type { InvoiceUploadFile } from "@/host/invoice-upload";
import { useOnlineHelpers } from "@/lib/online-helpers";

const decodeExtraction = Schema.decodeUnknownSync(InvoiceExtraction);

export const readInvoices = async (
  files: ReadonlyArray<InvoiceUploadFile>,
  extract: (documents: ReadonlyArray<InvoiceUploadFile>) => Promise<InvoiceExtraction>,
): Promise<InvoiceExtraction> => {
  const csvLines = files.map((file) =>
    isCsvFile(file) ? receivedStockFromCsv(new TextDecoder().decode(file.bytes)) : null,
  );
  const documents = files.filter((file) => !isCsvFile(file));
  const extracted = documents.length ? await extract(documents) : null;
  return decodeExtraction({
    supplier: extracted?.supplier ?? null,
    invoiceNumber: extracted?.invoiceNumber ?? null,
    lines: mergeReceivedStock(csvLines, extracted?.lines ?? []),
  });
};

export const useInvoiceReading = () => {
  const { available } = useOnlineHelpers();
  const online = useOnline();
  return {
    readsDocuments: available,
    analyseInvoices: (files: ReadonlyArray<InvoiceUploadFile>): Promise<InvoiceExtraction> =>
      readInvoices(files, async (documents) => {
        if (!available) throw new Error("Only CSV files can be imported.");
        if (!online) throw new Error("You're offline. Connect to read PDF invoices.");
        return appHost().analyseInvoices(documents);
      }),
  };
};
