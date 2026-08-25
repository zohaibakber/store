import type { ProductScanMode, ProductScanResult } from "@/features/product-scanner/types";

const FIELD_LABEL =
  /^(?:brand|composition|ingredients?|active ingredients?|each\s+\w+\s+contains?|batch|lot|b\.?\s*no|mfg|manufactured|exp|expiry|expires?|use before)\b/i;
const DATE_WITH_YEAR = /\b(\d{1,2})[\s./-](\d{1,2})[\s./-](20\d{2})\b/;
const MONTH_WITH_YEAR = /\b(0?[1-9]|1[0-2])[\s./-](\d{2}|20\d{2})\b/;
const ISO_DATE = /\b(20\d{2})[\s./-](0?[1-9]|1[0-2])(?:[\s./-](0?[1-9]|[12]\d|3[01]))?\b/;
const EXPIRY_LABEL = /(?:exp(?:iry|ires?)?|use\s+before|best\s+before)\s*(?:date)?\s*[:#-]?\s*/i;
const BATCH_LABEL =
  /(?:batch|lot|b\.?\s*no)\s*(?:number|no\.?|#)?\s*[:#-]?\s*([a-z0-9][a-z0-9./-]{1,30})/i;
const STRENGTH =
  /\b\d+(?:\.\d+)?\s*(?:mcg|µg|mg|g|ml|iu|%)\b(?:\s*\/\s*\d*(?:\.\d+)?\s*(?:ml|g))?/i;
const UNIT_COUNT =
  /\b(?:pack\s+of\s+)?(\d{1,4}(?:\s*[x×]\s*\d{1,4})*)\s*(?:tablets?|tabs?|capsules?|caps?|sachets?|ampoules?|vials?|pieces?|pcs?|doses?)\b/i;
const COMPOSITION_LABEL =
  /^(?:composition|ingredients?|active ingredients?|each\s+\w+\s+contains?)\s*[:.-]?\s*/i;

const tidy = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim() || null;

const validDate = (year: number, month: number, day: number) => {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

const isoDate = (year: number, month: number, day: number) =>
  validDate(year, month, day)
    ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : null;

export const normalizeExpiry = (value: string | null | undefined): string | null => {
  const candidate = tidy(value);
  if (!candidate) return null;

  const iso = candidate.match(ISO_DATE);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = iso[3] ? Number(iso[3]) : new Date(year, month, 0).getDate();
    return isoDate(year, month, day);
  }

  const full = candidate.match(DATE_WITH_YEAR);
  if (full) {
    const day = Number(full[1]);
    const month = Number(full[2]);
    // Product labels in this market are normally day-first.
    return isoDate(Number(full[3]), month, day);
  }

  const monthYear = candidate.match(MONTH_WITH_YEAR);
  if (monthYear) {
    const year = Number(monthYear[2]) < 100 ? 2000 + Number(monthYear[2]) : Number(monthYear[2]);
    // Month-only medicine expiries remain valid through the final day.
    const month = Number(monthYear[1]);
    return isoDate(year, month, new Date(year, month, 0).getDate());
  }
  return null;
};

const expiryFrom = (lines: ReadonlyArray<string>) => {
  const labelled = lines.find((line) => EXPIRY_LABEL.test(line));
  const labelledDate = labelled ? normalizeExpiry(labelled.replace(EXPIRY_LABEL, "")) : null;
  if (labelledDate) return labelledDate;
  return lines.map(normalizeExpiry).find((value): value is string => value !== null) ?? null;
};

const batchFrom = (lines: ReadonlyArray<string>) => {
  for (const line of lines) {
    const match = line.match(BATCH_LABEL);
    if (match?.[1]) return tidy(match[1])?.toLocaleUpperCase() ?? null;
  }
  return null;
};

const compositionFrom = (lines: ReadonlyArray<string>) => {
  const labelledIndex = lines.findIndex((line) => COMPOSITION_LABEL.test(line));
  if (labelledIndex < 0) return null;
  const sameLine = tidy(lines[labelledIndex]?.replace(COMPOSITION_LABEL, ""));
  if (sameLine) return sameLine;
  return tidy(lines[labelledIndex + 1]);
};

const likelyName = (lines: ReadonlyArray<string>) =>
  tidy(
    lines.find((line) => {
      const value = line.trim();
      return (
        value.length >= 2 &&
        value.length <= 70 &&
        /\p{L}/u.test(value) &&
        !FIELD_LABEL.test(value) &&
        !DATE_WITH_YEAR.test(value) &&
        !MONTH_WITH_YEAR.test(value) &&
        !ISO_DATE.test(value)
      );
    }),
  );

export const salvageUnitsPerPack = (
  name: string | null,
  unitsPerPack: number | null,
): number | null => {
  if (unitsPerPack === null) return null;
  const match = name?.match(/\d+(?:\s*[x×]\s*\d+)+/i);
  if (!match?.[0]) return unitsPerPack;
  const parsed = match[0]
    .split(/\s*[x×]\s*/i)
    .map(Number)
    .reduce((total, factor) => total * factor, 1);
  const concatenated = Number(match[0].replace(/[^\d]/g, ""));
  if (
    unitsPerPack === concatenated &&
    parsed !== concatenated &&
    Number.isSafeInteger(parsed) &&
    parsed >= 1 &&
    parsed <= 10_000
  ) {
    return parsed;
  }
  return unitsPerPack;
};

export const parseProductTextLocally = (
  recognizedText: string,
  mode: ProductScanMode,
): ProductScanResult => {
  const lines = recognizedText
    .split(/\r?\n/)
    .map((line) => line.replace(/[|]+/g, " ").trim())
    .filter(Boolean);
  const joined = lines.join(" ");
  const batchNumber = batchFrom(lines);
  const expiresAt = expiryFrom(lines);
  const composition = compositionFrom(lines);
  const strength = tidy(joined.match(STRENGTH)?.[0]);
  const unitsPerPackMatch = joined.match(UNIT_COUNT);
  const parsedUnitsPerPack = unitsPerPackMatch?.[1]
    ? unitsPerPackMatch[1]
        .split(/\s*[x×]\s*/i)
        .map(Number)
        .reduce((total, factor) => total * factor, 1)
    : null;
  const unitsPerPack =
    parsedUnitsPerPack !== null && parsedUnitsPerPack <= 10_000 ? parsedUnitsPerPack : null;
  const name = mode === "product" ? likelyName(lines) : null;
  const detected = [name, composition, strength, unitsPerPack, batchNumber, expiresAt].filter(
    Boolean,
  ).length;

  return {
    name,
    composition,
    strength,
    unitsPerPack,
    batchNumber,
    expiresAt,
    confidence: Math.min(0.82, detected * 0.16 + (lines.length > 2 ? 0.12 : 0)),
  };
};

export const expiryTimestamp = (value: string | null): number | null => {
  const normalized = normalizeExpiry(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return null;
  return new Date(year, month - 1, day).getTime();
};

export const expiryInputValue = (timestamp: number | null) => {
  if (timestamp === null) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
