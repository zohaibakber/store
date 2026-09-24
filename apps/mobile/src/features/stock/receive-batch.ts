import { EXPIRY_INPUT_HINT, readExpiryInput } from "@/scan/expiry";

export type ReceiveBatchFields = {
  readonly batchNumber: string;
  readonly expiry: string;
  readonly packs: string;
  readonly units: string;
};

export const emptyReceiveBatchFields: ReceiveBatchFields = {
  batchNumber: "",
  expiry: "",
  packs: "",
  units: "",
};

export type ReceiveBatchDraft = {
  readonly batchNumber: string | null;
  readonly expiresAt: number | null;
  readonly packQuantity: number;
  readonly unitQuantity: number;
};

export type ReceiveBatchField = keyof ReceiveBatchFields;

export type ReceiveBatchParse =
  | { readonly _tag: "valid"; readonly draft: ReceiveBatchDraft }
  | { readonly _tag: "invalid"; readonly field: ReceiveBatchField; readonly message: string };

export const expiryHint = EXPIRY_INPUT_HINT;

const parseQuantity = (text: string): number | "invalid" => {
  const value = text.trim();
  if (value.length === 0) return 0;
  return /^\d{1,7}$/.test(value) ? Number(value) : "invalid";
};

export const parseReceiveBatch = (fields: ReceiveBatchFields): ReceiveBatchParse => {
  const expiry = readExpiryInput(fields.expiry);
  if (expiry._tag === "Invalid") {
    return { _tag: "invalid", field: "expiry", message: `Use ${expiryHint}.` };
  }
  const packQuantity = parseQuantity(fields.packs);
  if (packQuantity === "invalid") {
    return { _tag: "invalid", field: "packs", message: "Enter a whole number of packs." };
  }
  const unitQuantity = parseQuantity(fields.units);
  if (unitQuantity === "invalid") {
    return { _tag: "invalid", field: "units", message: "Enter a whole number of units." };
  }
  if (packQuantity === 0 && unitQuantity === 0) {
    return { _tag: "invalid", field: "packs", message: "Add at least one pack or unit." };
  }
  const batchNumber = fields.batchNumber.trim();
  return {
    _tag: "valid",
    draft: {
      batchNumber: batchNumber.length > 0 ? batchNumber : null,
      expiresAt: expiry._tag === "Valid" ? expiry.expiresAt : null,
      packQuantity,
      unitQuantity,
    },
  };
};
