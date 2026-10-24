import { InvoiceExtraction } from "@store/contracts/server-api.schema";
import { isCsvFile, mergeReceivedStock, receivedStockFromCsv } from "@store/services/invoice-csv";
import * as Schema from "effect/Schema";

import { useOnline } from "@/hooks/use-online";
import { appHost } from "@/host";
import type { Workspace } from "@/host-access";
import type { InvoiceUploadFile } from "@/host/invoice-upload";
import { useAuth } from "@/lib/auth";

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

const savesOffline = (workspace: Workspace): boolean => {
  switch (workspace._tag) {
    case "Local":
      return true;
    case "Organization":
    case "None":
      return false;
  }
};

export const useInvoiceReading = () => {
  const { snapshot, workspace } = useAuth();
  const online = useOnline();
  const signedIn = snapshot?.status === "authenticated";
  return {
    isOnline: online || savesOffline(workspace),
    analyseInvoices: (files: ReadonlyArray<InvoiceUploadFile>): Promise<InvoiceExtraction> =>
      readInvoices(files, async (documents) => {
        if (!signedIn) {
          throw new Error("Reading PDF invoices needs an account. Sign in, or import a CSV file.");
        }
        if (!online) throw new Error("You're offline. Connect to read PDF invoices.");
        return appHost().analyseInvoices(documents);
      }),
  };
};
