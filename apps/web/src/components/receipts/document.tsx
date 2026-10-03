import type * as React from "react";

import { formatDateTime } from "@/lib/format-date";
import type { ReceiptFormat, ReceiptPaper } from "@/lib/receipt-format";
import { cn } from "@/lib/utils";

import type { Receipt } from "./receipt";

type ReceiptLayoutProps = {
  readonly format: ReceiptFormat;
  readonly receipt: Receipt;
  readonly storeName: string | null;
};

const WALK_IN = "Walk-in customer";

function Block({
  children,
  className,
}: {
  readonly children: string;
  readonly className?: string;
}) {
  const text = children.trim();
  if (text.length === 0) return null;
  return <p className={cn("wrap-anywhere whitespace-pre-line", className)}>{text}</p>;
}

function AmountRow({
  label,
  strong = false,
  value,
}: {
  readonly label: string;
  readonly strong?: boolean;
  readonly value: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4", strong && "font-medium")}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function Amounts({ receipt }: { readonly receipt: Receipt }) {
  if (receipt.discount === null) return null;
  return (
    <>
      <AmountRow label="Subtotal" value={receipt.subtotal} />
      <AmountRow label="Discount" value={`−${receipt.discount}`} />
    </>
  );
}

function A4Invoice({ format, receipt, storeName }: ReceiptLayoutProps) {
  return (
    <article className="flex flex-col gap-6 text-sm">
      <header className="flex items-start justify-between gap-8">
        <div className="flex min-w-0 flex-col gap-0.5 text-muted-foreground">
          {storeName === null ? null : (
            <p className="text-lg font-medium wrap-anywhere text-foreground">{storeName}</p>
          )}
          <Block>{format.address}</Block>
          <Block className="tabular-nums">{format.phone}</Block>
          <Block>{format.registration}</Block>
        </div>
        <div className="flex shrink-0 flex-col gap-0.5 text-end tabular-nums">
          <p className="text-lg font-medium">Invoice #{receipt.number}</p>
          <p className="text-muted-foreground">{formatDateTime(receipt.issuedAt)}</p>
        </div>
      </header>
      <p>
        <span className="text-muted-foreground">Customer </span>
        <span className="font-medium wrap-anywhere">{receipt.customer ?? WALK_IN}</span>
      </p>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="w-8 py-1.5 text-start font-medium">#</th>
            <th className="py-1.5 text-start font-medium">Product</th>
            {format.showBatch ? (
              <th className="w-28 py-1.5 text-start font-medium">Batch</th>
            ) : null}
            <th className="w-24 py-1.5 text-end font-medium">Qty</th>
            <th className="w-28 py-1.5 text-end font-medium">Unit price</th>
            <th className="w-28 py-1.5 text-end font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.map((line, index) => (
            <tr className="break-inside-avoid border-b align-top" key={line.key}>
              <td className="py-1.5 tabular-nums">{index + 1}</td>
              <td className="py-1.5 pe-4 wrap-anywhere">{line.name}</td>
              {format.showBatch ? (
                <td className="py-1.5 pe-4 wrap-anywhere tabular-nums">{line.batch}</td>
              ) : null}
              <td className="py-1.5 text-end tabular-nums">{line.quantity}</td>
              <td className="py-1.5 text-end tabular-nums">{line.unitPrice}</td>
              <td className="py-1.5 text-end tabular-nums">{line.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="flex w-64 break-inside-avoid flex-col gap-1 self-end">
        <Amounts receipt={receipt} />
        <div className="text-base">
          <AmountRow label="Total" strong value={receipt.total} />
        </div>
      </dl>
      <Block className="text-muted-foreground">{format.footer}</Block>
    </article>
  );
}

function Rule() {
  return <div aria-hidden="true" className="border-t border-dashed border-foreground" />;
}

function ThermalReceipt({ format, receipt, storeName }: ReceiptLayoutProps) {
  return (
    <article className="flex flex-col gap-2 text-xs">
      <header className="flex flex-col items-center gap-0.5 text-center">
        {storeName === null ? null : (
          <p className="text-base font-medium wrap-anywhere">{storeName}</p>
        )}
        <Block>{format.address}</Block>
        <Block className="tabular-nums">{format.phone}</Block>
        <Block>{format.registration}</Block>
      </header>
      <Rule />
      <div className="flex flex-wrap justify-between gap-x-2 tabular-nums">
        <span className="font-medium">Invoice #{receipt.number}</span>
        <span>{formatDateTime(receipt.issuedAt)}</span>
      </div>
      {receipt.customer === null ? null : (
        <p className="wrap-anywhere">Customer: {receipt.customer}</p>
      )}
      <Rule />
      <ul className="flex flex-col gap-1.5">
        {receipt.lines.map((line) => (
          <li className="break-inside-avoid" key={line.key}>
            <p className="wrap-anywhere">{line.name}</p>
            <div className="flex flex-wrap justify-between gap-x-2 tabular-nums">
              <span>
                {line.quantity} × {line.unitPrice}
              </span>
              <span className="ms-auto">{line.amount}</span>
            </div>
            {format.showBatch && line.batch !== null ? (
              <p className="wrap-anywhere tabular-nums">Batch {line.batch}</p>
            ) : null}
          </li>
        ))}
      </ul>
      <Rule />
      <dl className="flex flex-col gap-0.5">
        <Amounts receipt={receipt} />
        <div className="text-sm">
          <AmountRow label="Total" strong value={receipt.total} />
        </div>
      </dl>
      {format.footer.trim().length === 0 ? null : (
        <>
          <Rule />
          <Block className="text-center">{format.footer}</Block>
        </>
      )}
    </article>
  );
}

const sheetOf = (paper: ReceiptPaper, format: Pick<ReceiptFormat, "rollWidth">) => {
  switch (paper) {
    case "a4":
      return "a4" as const;
    case "thermal":
      return `roll-${format.rollWidth}` as const;
  }
};

export function ReceiptSheet({
  className,
  format,
  paper,
  receipt,
  storeName,
  ...props
}: ReceiptLayoutProps &
  Omit<React.ComponentProps<"div">, "children"> & { readonly paper: ReceiptPaper }) {
  const Layout = paper === "a4" ? A4Invoice : ThermalReceipt;
  return (
    <div
      className={cn("bg-background text-foreground", className)}
      data-paper={sheetOf(paper, format)}
      {...props}
    >
      <Layout format={format} receipt={receipt} storeName={storeName} />
    </div>
  );
}
