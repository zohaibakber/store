import type { Invoice, InvoiceItem } from "@store/contracts";
import { formatInvoiceNumber } from "@store/contracts/store-helpers";
import { formatPrice } from "@store/services/format";

import { formatCount } from "@/lib/format";

export type ReceiptLine = {
  readonly key: string;
  readonly name: string;
  readonly batch: string | null;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly amount: string;
};

export type Receipt = {
  readonly number: string;
  readonly issuedAt: number;
  readonly customer: string | null;
  readonly lines: ReadonlyArray<ReceiptLine>;
  readonly subtotal: string;
  readonly discount: string | null;
  readonly total: string;
};

const lineAmount = (item: Pick<InvoiceItem, "quantity" | "salePrice">) =>
  item.quantity * item.salePrice;

const receiptLine = (item: InvoiceItem): ReceiptLine => ({
  key: item.id,
  name: item.productName,
  batch: item.batchNumber,
  quantity: formatCount(item.quantity, item.quantityType === "pack" ? "pack" : "unit"),
  unitPrice: formatPrice(item.salePrice),
  amount: formatPrice(lineAmount(item)),
});

export const receiptOf = (invoice: Invoice): Receipt => {
  const subtotal = invoice.items.reduce((sum, item) => sum + lineAmount(item), 0);
  const discount = subtotal - invoice.total;
  return {
    number: formatInvoiceNumber(invoice.invoiceNumber),
    issuedAt: invoice.createdAt,
    customer: invoice.customerName,
    lines: invoice.items.map(receiptLine),
    subtotal: formatPrice(subtotal),
    discount: discount > 0 ? formatPrice(discount) : null,
    total: formatPrice(invoice.total),
  };
};

const SAMPLE_ISSUED_AT = new Date(2026, 0, 15, 16, 30).getTime();

export const SAMPLE_RECEIPT: Receipt = {
  number: formatInvoiceNumber(128),
  issuedAt: SAMPLE_ISSUED_AT,
  customer: "Ayesha Khan",
  lines: [
    {
      key: "panadol",
      name: "Panadol 500 mg tablets",
      batch: "PN-2291",
      quantity: formatCount(2, "pack"),
      unitPrice: formatPrice(45_000),
      amount: formatPrice(90_000),
    },
    {
      key: "augmentin",
      name: "Augmentin 625 mg tablets",
      batch: "AG-0417",
      quantity: formatCount(6, "unit"),
      unitPrice: formatPrice(5_500),
      amount: formatPrice(33_000),
    },
    {
      key: "ors",
      name: "ORS orange sachet",
      batch: null,
      quantity: formatCount(4, "unit"),
      unitPrice: formatPrice(3_000),
      amount: formatPrice(12_000),
    },
  ],
  subtotal: formatPrice(135_000),
  discount: formatPrice(6_750),
  total: formatPrice(128_250),
};
