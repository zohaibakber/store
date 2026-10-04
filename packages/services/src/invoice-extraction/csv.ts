import type { InvoiceExtractionLine } from "@store/contracts/server-api.schema";

import { hasReceivedStock, normalizeLine } from "./line";
import { parseMajorCurrencyToMinor } from "./pack-size";

const parseCsvRecords = (contents: string): ReadonlyArray<ReadonlyArray<string>> => {
  const records: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const text = contents.replace(/^\uFEFF/, "");

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === undefined) continue;
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
          continue;
        }
        inQuotes = false;
        continue;
      }
      field += character;
      continue;
    }
    if (character === '"') {
      inQuotes = true;
      continue;
    }
    if (character === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (character === "\n") {
      row.push(field);
      records.push(row);
      row = [];
      field = "";
      continue;
    }
    if (character === "\r") continue;
    field += character;
  }

  if (inQuotes || field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  return records.filter((record) => record.some((cell) => cell.trim().length > 0));
};

const parseCsv = (contents: string): ReadonlyArray<InvoiceExtractionLine> => {
  const [headerRow = [], ...rows] = parseCsvRecords(contents);
  const headers = headerRow.map((value) => value.trim().toLowerCase());
  const valueAt = (row: ReadonlyArray<string>, name: string) =>
    row[headers.indexOf(name)]?.trim() ?? "";
  return rows.map((values) =>
    normalizeLine({
      name:
        valueAt(values, "name") || valueAt(values, "product") || valueAt(values, "product name"),
      batchNumber: valueAt(values, "batch") || valueAt(values, "batch number") || null,
      expiresAt: valueAt(values, "expiry") || valueAt(values, "expires at") || null,
      packQuantity: valueAt(values, "packs") || valueAt(values, "pack quantity") || 0,
      unitQuantity: valueAt(values, "units") || valueAt(values, "unit quantity") || 0,
      unitsPerPack: valueAt(values, "units per pack") || 1,
      packPrice: parseMajorCurrencyToMinor(valueAt(values, "pack price")),
    }),
  );
};

export const receivedStockFromCsv = (contents: string): ReadonlyArray<InvoiceExtractionLine> =>
  parseCsv(contents).filter(hasReceivedStock);

export const isCsvFile = (file: { readonly name: string }): boolean =>
  file.name.toLowerCase().endsWith(".csv");

export const mergeReceivedStock = (
  csvLinesByFile: ReadonlyArray<ReadonlyArray<InvoiceExtractionLine> | null>,
  documentLines: ReadonlyArray<InvoiceExtractionLine>,
): ReadonlyArray<InvoiceExtractionLine> => {
  const firstDocument = csvLinesByFile.indexOf(null);
  return csvLinesByFile.flatMap(
    (lines, index) => lines ?? (index === firstDocument ? documentLines : []),
  );
};
