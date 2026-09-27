import { appHost } from "@/host";
import type { InvoiceUploadFile } from "@/lib/invoice-upload";

export const analyseInvoices = (files: ReadonlyArray<InvoiceUploadFile>) =>
  appHost().analyseInvoices(files);
