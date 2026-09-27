import {
  findExpiryMentions,
  formatExpiry,
  likelyExpiry,
  parseExpiry,
  readExpiryInput,
  sameExpiryMonth,
} from "./expiry";
import { LOW_CONFIDENCE, type ProductScanResult, type ReviewEdits } from "./model";

export type ScanField =
  | "name"
  | "composition"
  | "strength"
  | "unitsPerPack"
  | "batchNumber"
  | "expiresAt";

export const SCAN_FIELDS: ReadonlyArray<ScanField> = [
  "name",
  "composition",
  "strength",
  "unitsPerPack",
  "batchNumber",
  "expiresAt",
];

export type FieldFlags = { readonly [Field in ScanField]: string | null };

export type ReviewValues = { readonly [Field in ScanField]: string };

export const NO_FLAGS: FieldFlags = {
  name: null,
  composition: null,
  strength: null,
  unitsPerPack: null,
  batchNumber: null,
  expiresAt: null,
};

export const normalizeScanText = (text: string): string =>
  text.toLowerCase().replace(/\s+/g, " ").trim();

const compact = (text: string): string => text.toLowerCase().replace(/\s+/g, "");

export const textContains = (haystack: string, needle: string): boolean => {
  const wanted = compact(needle);
  return wanted.length > 0 && compact(haystack).includes(wanted);
};

export const packCountsInText = (text: string): ReadonlySet<number> => {
  const counts = new Set<number>();
  for (const match of text.matchAll(/(\d{1,4})\s*[x×*]\s*(\d{1,4})/gi)) {
    counts.add(Number(match[1]) * Number(match[2]));
  }
  for (const match of text.matchAll(/\d{1,5}/g)) counts.add(Number(match[0]));
  return counts;
};

type FieldEvidence = {
  readonly present: boolean;
  readonly labelText: string | null;
};

const evidenceFor = (
  field: ScanField,
  result: ProductScanResult,
  recognizedText: string,
): FieldEvidence | null => {
  switch (field) {
    case "unitsPerPack":
      return result.unitsPerPack === null
        ? null
        : { present: packCountsInText(recognizedText).has(result.unitsPerPack), labelText: null };
    case "expiresAt": {
      if (result.expiresAt === null) return null;
      const parsed = parseExpiry(result.expiresAt);
      const mentions = findExpiryMentions(recognizedText);
      const labelled = likelyExpiry(mentions);
      const present =
        parsed !== null && mentions.some((mention) => sameExpiryMonth(mention.value, parsed));
      return { present, labelText: labelled?.raw ?? null };
    }
    default: {
      const value = result[field];
      return value === null
        ? null
        : { present: textContains(recognizedText, value), labelText: null };
    }
  }
};

const missingReason = (field: ScanField): string =>
  field === "expiresAt" ? "No expiry found on the label" : "Not found on the label";

const confirmReason = (labelText: string | null, fallback: string): string =>
  labelText === null ? `${fallback} · tap to confirm` : `Label says ${labelText} · tap to confirm`;

export const deriveFieldFlags = (
  result: ProductScanResult | null,
  recognizedText: string,
): FieldFlags => {
  if (result === null) return NO_FLAGS;
  const lowConfidence = result.confidence < LOW_CONFIDENCE;
  const flagFor = (field: ScanField): string | null => {
    const evidence = evidenceFor(field, result, recognizedText);
    if (evidence === null) return missingReason(field);
    if (!evidence.present) return confirmReason(evidence.labelText, "Not on the label");
    if (lowConfidence) return confirmReason(evidence.labelText, "Low confidence");
    return null;
  };
  return {
    name: flagFor("name"),
    composition: flagFor("composition"),
    strength: flagFor("strength"),
    unitsPerPack: flagFor("unitsPerPack"),
    batchNumber: flagFor("batchNumber"),
    expiresAt: flagFor("expiresAt"),
  };
};

const expiryText = (text: string | null): string => {
  if (text === null) return "";
  const parsed = parseExpiry(text);
  return parsed === null ? text : formatExpiry(parsed);
};

export const reviewValuesFrom = (result: ProductScanResult | null): ReviewValues => ({
  name: result?.name ?? "",
  composition: result?.composition ?? "",
  strength: result?.strength ?? "",
  unitsPerPack: result === null || result.unitsPerPack === null ? "" : String(result.unitsPerPack),
  batchNumber: result?.batchNumber ?? "",
  expiresAt: expiryText(result?.expiresAt ?? null),
});

const BATCH_PREFIX =
  /^\s*(?:B\.?\s*NO\.?|BATCH(?:\s*NO\.?)?|LOT(?:\s*NO\.?)?|BN|B\/N)\s*[:#.-]?\s*/i;

export const valueFromChip = (field: ScanField, chip: string): string => {
  const text = chip.trim();
  switch (field) {
    case "unitsPerPack": {
      const factors = /(\d{1,4})\s*[x×*]\s*(\d{1,4})/i.exec(text);
      if (factors) return String(Number(factors[1]) * Number(factors[2]));
      return /\d{1,5}/.exec(text)?.[0] ?? text;
    }
    case "expiresAt": {
      const mention = likelyExpiry(findExpiryMentions(text)) ?? findExpiryMentions(text)[0];
      return mention === undefined ? text : formatExpiry(mention.value);
    }
    case "batchNumber":
      return text.replace(BATCH_PREFIX, "");
    default:
      return text;
  }
};

export type CommitChoice = "addBatch" | "newProduct";

export type MatchedProduct = {
  readonly id: string;
  readonly name: string;
  readonly unitsPerPack: number;
};

export type BatchFields = {
  readonly batchNumber: string | null;
  readonly expiresAt: number | null;
  readonly packQuantity: number;
  readonly unitQuantity: number;
};

export type CommitPlan =
  | {
      readonly _tag: "AddBatch";
      readonly productId: string;
      readonly productName: string;
      readonly batch: BatchFields;
    }
  | {
      readonly _tag: "NewProduct";
      readonly product: {
        readonly name: string;
        readonly composition: string | null;
        readonly strength: string | null;
        readonly unitsPerPack: number;
      };
      readonly batch: BatchFields;
    }
  | { readonly _tag: "Invalid"; readonly message: string };

const optionalText = (value: string): string | null => value.trim() || null;

const positiveInteger = (value: string): number | null => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return parsed >= 1 ? parsed : null;
};

const invalid = (message: string): CommitPlan => ({ _tag: "Invalid", message });

export const planCommit = (
  choice: CommitChoice,
  values: ReviewValues,
  packs: number,
  match: MatchedProduct | null,
): CommitPlan => {
  if (!Number.isInteger(packs) || packs < 1) return invalid("Enter how many packs arrived.");
  const expiry = readExpiryInput(values.expiresAt);
  if (expiry._tag === "Invalid") return invalid("Enter the expiry as MM/YYYY.");
  const batch: BatchFields = {
    batchNumber: optionalText(values.batchNumber),
    expiresAt: expiry._tag === "Valid" ? expiry.expiresAt : null,
    packQuantity: packs,
    unitQuantity: 0,
  };
  if (choice === "addBatch") {
    if (match === null) return invalid("Pick the product this batch belongs to.");
    return { _tag: "AddBatch", productId: match.id, productName: match.name, batch };
  }
  const name = values.name.trim();
  if (!name) return invalid("Enter the product name.");
  const unitsPerPack = positiveInteger(values.unitsPerPack);
  if (unitsPerPack === null) return invalid("Enter how many units are in one pack.");
  return {
    _tag: "NewProduct",
    product: {
      name,
      composition: optionalText(values.composition),
      strength: optionalText(values.strength),
      unitsPerPack,
    },
    batch,
  };
};

const packsText = (packs: number) => `${packs} ${packs === 1 ? "pack" : "packs"}`;

export const commitLabel = (
  choice: CommitChoice,
  values: ReviewValues,
  packs: number,
  match: MatchedProduct | null,
): string => {
  if (choice === "addBatch" && match !== null) return `Add ${packsText(packs)} to ${match.name}`;
  const name = values.name.trim();
  return name
    ? `Create ${name} with ${packsText(packs)}`
    : `Create product with ${packsText(packs)}`;
};

export const commitSummary = (
  choice: CommitChoice,
  values: ReviewValues,
  packs: number,
  match: MatchedProduct | null,
): string => {
  if (choice === "addBatch" && match !== null) return `Added ${packsText(packs)} to ${match.name}`;
  const name = values.name.trim() || "the product";
  return `Created ${name} with ${packsText(packs)}`;
};

export const defaultChoice = (match: MatchedProduct | null): CommitChoice =>
  match === null ? "newProduct" : "addBatch";

export const editedFields = (edits: ReviewEdits | undefined): ReadonlySet<ScanField> =>
  new Set(SCAN_FIELDS.filter((field) => edits?.[field] !== undefined));

export const reviewValuesWith = (
  result: ProductScanResult | null,
  edits: ReviewEdits | undefined,
): ReviewValues => {
  const parsed = reviewValuesFrom(result);
  return {
    name: edits?.name ?? parsed.name,
    composition: edits?.composition ?? parsed.composition,
    strength: edits?.strength ?? parsed.strength,
    unitsPerPack: edits?.unitsPerPack ?? parsed.unitsPerPack,
    batchNumber: edits?.batchNumber ?? parsed.batchNumber,
    expiresAt: edits?.expiresAt ?? parsed.expiresAt,
  };
};

export const editsFrom = (values: ReviewValues, edited: ReadonlySet<ScanField>): ReviewEdits => {
  const kept = (field: ScanField) => (edited.has(field) ? values[field] : undefined);
  const edits: { -readonly [Field in ScanField]?: string } = {};
  for (const field of SCAN_FIELDS) {
    const value = kept(field);
    if (value !== undefined) edits[field] = value;
  }
  return edits;
};

export const sameEdits = (left: ReviewEdits | undefined, right: ReviewEdits): boolean =>
  SCAN_FIELDS.every((field) => left?.[field] === right[field]);

export type AutoFill = {
  readonly values: ReviewValues;
  readonly filled: ReadonlyArray<ScanField>;
};

export const mergeAutoFill = (
  current: ReviewValues,
  edited: ReadonlySet<ScanField>,
  result: ProductScanResult,
): AutoFill => {
  const parsed = reviewValuesFrom(result);
  const fills = (field: ScanField) =>
    !edited.has(field) && parsed[field] !== "" && parsed[field] !== current[field];
  const pick = (field: ScanField) => (fills(field) ? parsed[field] : current[field]);
  return {
    values: {
      name: pick("name"),
      composition: pick("composition"),
      strength: pick("strength"),
      unitsPerPack: pick("unitsPerPack"),
      batchNumber: pick("batchNumber"),
      expiresAt: pick("expiresAt"),
    },
    filled: SCAN_FIELDS.filter(fills),
  };
};

const BATCH_REVIEW_FIELDS: ReadonlyArray<ScanField> = ["batchNumber", "expiresAt"];
const NEW_PRODUCT_REVIEW_FIELDS: ReadonlyArray<ScanField> = [
  "name",
  "unitsPerPack",
  "batchNumber",
  "expiresAt",
];
const OPTIONAL_PRODUCT_FIELDS: ReadonlyArray<ScanField> = ["composition", "strength"];

export const needsCheck = (
  flags: FieldFlags,
  result: ProductScanResult,
  matched: boolean,
): boolean => {
  if (result.confidence < LOW_CONFIDENCE) return true;
  if (matched) return BATCH_REVIEW_FIELDS.some((field) => flags[field] !== null);
  if (NEW_PRODUCT_REVIEW_FIELDS.some((field) => flags[field] !== null)) return true;
  return OPTIONAL_PRODUCT_FIELDS.some((field) => result[field] !== null && flags[field] !== null);
};
