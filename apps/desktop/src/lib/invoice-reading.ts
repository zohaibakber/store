import { InvoiceExtraction } from "@store/contracts/server-api.schema";
import { receivedStockFromCsv } from "@store/services/invoice-csv";
import * as Schema from "effect/Schema";

import { useOnline } from "@/hooks/use-online";
import { appHost } from "@/host";
import type { Workspace } from "@/host-access";
import { useAuth } from "@/lib/auth";
import type { InvoiceUploadFile } from "@/lib/invoice-upload";

const decodeExtraction = Schema.decodeUnknownSync(InvoiceExtraction);

const isCsv = (file: InvoiceUploadFile) => file.name.toLowerCase().endsWith(".csv");

export const readCsvInvoices = (
  files: ReadonlyArray<InvoiceUploadFile>,
): InvoiceExtraction | null => {
  const csvFiles = files.filter(isCsv);
  const lines = csvFiles.flatMap((file) =>
    receivedStockFromCsv(new TextDecoder().decode(file.bytes)),
  );
  if (lines.length === 0 && csvFiles.length < files.length) return null;
  return decodeExtraction({ supplier: null, invoiceNumber: null, lines });
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
    analyseInvoices: async (
      files: ReadonlyArray<InvoiceUploadFile>,
    ): Promise<InvoiceExtraction> => {
      const read = readCsvInvoices(files);
      if (read !== null) return read;
      if (!signedIn) {
        throw new Error("Reading PDF invoices needs an account. Sign in, or import a CSV file.");
      }
      if (!online) throw new Error("You're offline. Connect to read PDF invoices.");
      return appHost().analyseInvoices(files);
    },
  };
};
