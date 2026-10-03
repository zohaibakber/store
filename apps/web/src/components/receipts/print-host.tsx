import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useSuspenseInventoryInvoice } from "@store/inventory-react";
import * as Atom from "effect/reactivity/Atom";
import { Suspense, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { toastManager } from "@/components/ui/toast";
import { useReceiptFormat, useReceiptStoreName } from "@/hooks/use-receipt-format";
import { appHost } from "@/host";
import type { PrintPage } from "@/host/share";
import { storeErrorMessage } from "@/lib/errors";
import type { ReceiptFormat, ReceiptPaper } from "@/lib/receipt-format";

import { ReceiptSheet } from "./document";
import { receiptOf } from "./receipt";

export type ReceiptPrintJob = {
  readonly invoiceId: string;
  readonly paper: ReceiptPaper;
  readonly output: "printer" | "pdf";
};

const printJobAtom = Atom.make<ReceiptPrintJob | null>(null).pipe(Atom.keepAlive);

export const usePrintReceipt = () => useAtomSet(printJobAtom);

export const useReceiptPrinting = (): boolean => useAtomValue(printJobAtom) !== null;

const MM_PER_PX = 25.4 / 96;
const ROLL_SLACK_MM = 2;
const ROLL_HEIGHT_MM = { minimum: 20, maximum: 5000 } as const;

const rollHeightMm = (sheet: HTMLElement) =>
  Math.min(
    ROLL_HEIGHT_MM.maximum,
    Math.max(
      ROLL_HEIGHT_MM.minimum,
      Math.ceil(sheet.getBoundingClientRect().height * MM_PER_PX) + ROLL_SLACK_MM,
    ),
  );

const pageOf = (paper: ReceiptPaper, format: ReceiptFormat, sheet: HTMLElement): PrintPage => {
  switch (paper) {
    case "a4":
      return { _tag: "A4" };
    case "thermal":
      return { _tag: "Roll", widthMm: format.rollWidth, heightMm: rollHeightMm(sheet) };
  }
};

const deliver = async (job: ReceiptPrintJob, page: PrintPage, fileStem: string) => {
  const outcome =
    job.output === "pdf" ? await appHost().savePdf(fileStem) : await appHost().print(page);
  switch (outcome._tag) {
    case "saved":
      toastManager.add({ title: `Saved ${outcome.fileName}`, type: "success" });
      break;
    case "failed":
      toastManager.add({ title: outcome.message, type: "error" });
      break;
    case "printed":
    case "cancelled":
      break;
  }
};

function PrintJob({ job, onDone }: { readonly job: ReceiptPrintJob; readonly onDone: () => void }) {
  const invoice = useSuspenseInventoryInvoice(job.invoiceId);
  const format = useReceiptFormat();
  const storeName = useReceiptStoreName();
  const sheet = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (invoice === undefined || sheet.current === null) {
      toastManager.add({ title: "This invoice is no longer available to print.", type: "error" });
      onDone();
      return;
    }
    const receipt = receiptOf(invoice);
    const page = pageOf(job.paper, format, sheet.current);
    void deliver(job, page, `invoice-${receipt.number}`)
      .catch((cause: unknown) =>
        toastManager.add({
          title: storeErrorMessage(cause, "Could not print the receipt."),
          type: "error",
        }),
      )
      .finally(onDone);
  }, [format, invoice, job, onDone]);

  if (invoice === undefined) return null;
  return createPortal(
    <ReceiptSheet
      className="invisible fixed top-0 left-0 print:visible print:static"
      data-print-root=""
      format={format}
      paper={job.paper}
      receipt={receiptOf(invoice)}
      ref={sheet}
      storeName={storeName}
    />,
    document.body,
  );
}

export function ReceiptPrintHost() {
  const [job, setJob] = useAtom(printJobAtom);
  if (job === null) return null;
  return (
    <Suspense fallback={null}>
      <PrintJob job={job} onDone={() => setJob(null)} />
    </Suspense>
  );
}
