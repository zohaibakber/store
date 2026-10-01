import type { InvoiceExtractionLine } from "@store/contracts/server-api.schema";

import { parseUnitsPerPack, salvageUnitsPerPack } from "./pack-size";

type PrintedValue = string | number | boolean | null;

export type PrintedInvoiceLine = {
  readonly name?: PrintedValue | undefined;
  readonly batchNumber?: PrintedValue | undefined;
  readonly expiresAt?: PrintedValue | undefined;
  readonly packQuantity?: PrintedValue | undefined;
  readonly unitQuantity?: PrintedValue | undefined;
  readonly unitsPerPack?: PrintedValue | undefined;
  readonly packPrice?: PrintedValue | undefined;
};

const isString = <Value>(value: Value): value is Value & string => typeof value === "string";
const isNumber = <Value>(value: Value): value is Value & number => typeof value === "number";

const toFiniteNumber = (value: PrintedValue | undefined): number | null => {
  if (isNumber(value)) return Number.isFinite(value) ? value : null;
  if (!isString(value)) return null;
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

export const nullableString = (value: PrintedValue | undefined): string | null => {
  if (isString(value)) return value.trim() || null;
  if (value !== undefined && value !== null) return String(value);
  return null;
};

const count = (value: PrintedValue | undefined, fallback: number, minimum: number): number =>
  Math.max(minimum, Math.round(toFiniteNumber(value) ?? fallback));

const unspecifiedItemName = "Unspecified item";

export const hasReceivedStock = (line: InvoiceExtractionLine): boolean => {
  const name = line.name.trim();
  return (
    name.length > 0 && name !== unspecifiedItemName && line.packQuantity + line.unitQuantity > 0
  );
};

export const normalizeLine = (value: PrintedInvoiceLine): InvoiceExtractionLine => {
  const name = nullableString(value.name) ?? unspecifiedItemName;
  return {
    name,
    batchNumber: nullableString(value.batchNumber),
    expiresAt: nullableString(value.expiresAt),
    packQuantity: count(value.packQuantity, 0, 0),
    unitQuantity: count(value.unitQuantity, 0, 0),
    unitsPerPack: salvageUnitsPerPack(
      name,
      isString(value.unitsPerPack) || isNumber(value.unitsPerPack)
        ? parseUnitsPerPack(value.unitsPerPack, 1)
        : 1,
    ),
    packPrice:
      value.packPrice == null
        ? null
        : Math.max(0, Math.round(toFiniteNumber(value.packPrice) ?? 0)),
  };
};
