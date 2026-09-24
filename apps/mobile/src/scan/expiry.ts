export type ExpiryValue = {
  readonly year: number;
  readonly month: number;
  readonly day: number | null;
};

export type ExpiryMention = {
  readonly raw: string;
  readonly value: ExpiryValue;
  readonly label: "expiry" | "manufactured" | "none";
  readonly index: number;
};

const MONTH_NAMES = "JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEPT|SEP|OCT|NOV|DEC";

const MONTH_NUMBERS = new Map<string, number>([
  ["JAN", 1],
  ["FEB", 2],
  ["MAR", 3],
  ["APR", 4],
  ["MAY", 5],
  ["JUN", 6],
  ["JUL", 7],
  ["AUG", 8],
  ["SEP", 9],
  ["SEPT", 9],
  ["OCT", 10],
  ["NOV", 11],
  ["DEC", 12],
]);

type DatePattern = {
  readonly pattern: RegExp;
  readonly read: (groups: ReadonlyArray<string | undefined>) => ExpiryValue | null;
};

const fullYear = (text: string | undefined): number | null => {
  if (text === undefined) return null;
  const year = Number(text);
  if (!Number.isInteger(year)) return null;
  const expanded = text.length === 2 ? 2000 + year : year;
  return expanded >= 2000 && expanded <= 2099 ? expanded : null;
};

const monthNumber = (text: string | undefined): number | null => {
  if (text === undefined) return null;
  const named = MONTH_NUMBERS.get(text.toUpperCase());
  if (named !== undefined) return named;
  const month = Number(text);
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
};

const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();

const expiryValue = (
  yearText: string | undefined,
  monthText: string | undefined,
  dayText: string | undefined,
): ExpiryValue | null => {
  const year = fullYear(yearText);
  const month = monthNumber(monthText);
  if (year === null || month === null) return null;
  if (dayText === undefined) return { year, month, day: null };
  const day = Number(dayText);
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
};

const DATE_PATTERNS: ReadonlyArray<DatePattern> = [
  {
    pattern: /\b(20\d{2})[-/.](0?[1-9]|1[0-2])(?:[-/.](0?[1-9]|[12]\d|3[01]))?\b/g,
    read: ([, year, month, day]) => expiryValue(year, month, day),
  },
  {
    pattern: /\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](20\d{2}|\d{2})\b/g,
    read: ([, day, month, year]) => expiryValue(year, month, day),
  },
  {
    pattern: new RegExp(
      `\\b(0?[1-9]|[12]\\d|3[01])[\\s\\-./]?(${MONTH_NAMES})[A-Z]*[\\s\\-.,'/]*(20\\d{2}|\\d{2})\\b`,
      "g",
    ),
    read: ([, day, month, year]) => expiryValue(year, month, day),
  },
  {
    pattern: new RegExp(`\\b(${MONTH_NAMES})[A-Z]*[\\s\\-.,'/]*(20\\d{2}|\\d{2})\\b`, "g"),
    read: ([, month, year]) => expiryValue(year, month, undefined),
  },
  {
    pattern: /\b(0?[1-9]|1[0-2])\s?[-/.]\s?(20\d{2}|\d{2})\b/g,
    read: ([, month, year]) => expiryValue(year, month, undefined),
  },
];

const EXPIRY_LABEL = /(?:EXP[A-Z]*|USE\s*BY|USE\s*BEFORE|BEST\s*BEFORE|\bE\.?\s?D)\W*(?:DATE)?\W*$/;
const MANUFACTURE_LABEL = /(?:MFG|MFD|MANUF[A-Z]*|\bM\.?\s?D)\W*(?:DATE)?\W*$/;

const labelBefore = (text: string, index: number): ExpiryMention["label"] => {
  const preceding = text.slice(Math.max(0, index - 16), index);
  if (EXPIRY_LABEL.test(preceding)) return "expiry";
  if (MANUFACTURE_LABEL.test(preceding)) return "manufactured";
  return "none";
};

export const findExpiryMentions = (text: string): ReadonlyArray<ExpiryMention> => {
  const upper = text.toUpperCase();
  const covered: Array<readonly [number, number]> = [];
  const mentions: Array<ExpiryMention> = [];
  for (const { pattern, read } of DATE_PATTERNS) {
    for (const match of upper.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (covered.some(([from, to]) => start < to && end > from)) continue;
      covered.push([start, end]);
      const value = read(match);
      if (value === null) continue;
      mentions.push({
        raw: text.slice(start, end).trim(),
        value,
        label: labelBefore(upper, start),
        index: start,
      });
    }
  }
  return mentions.sort((left, right) => left.index - right.index);
};

const compareExpiry = (left: ExpiryValue, right: ExpiryValue) =>
  left.year - right.year || left.month - right.month || (left.day ?? 31) - (right.day ?? 31);

export const likelyExpiry = (mentions: ReadonlyArray<ExpiryMention>): ExpiryMention | null => {
  const labelled = mentions.find((mention) => mention.label === "expiry");
  if (labelled) return labelled;
  const unlabelled = mentions.filter((mention) => mention.label === "none");
  if (unlabelled.length === 0) return null;
  return unlabelled.reduce((latest, mention) =>
    compareExpiry(mention.value, latest.value) > 0 ? mention : latest,
  );
};

const EXPIRY_PREFIX =
  /^\s*(?:EXP[A-Z]*|USE\s*BY|USE\s*BEFORE|BEST\s*BEFORE|E\.?\s?D\.?)\W*(?:DATE)?\W*/i;

export const parseExpiry = (text: string): ExpiryValue | null => {
  const [first] = findExpiryMentions(text.replace(EXPIRY_PREFIX, ""));
  return first?.value ?? null;
};

const twoDigits = (value: number) => String(value).padStart(2, "0");

export const formatExpiry = (value: ExpiryValue): string =>
  value.day === null
    ? `${twoDigits(value.month)}/${value.year}`
    : `${twoDigits(value.day)}/${twoDigits(value.month)}/${value.year}`;

export const expiryTimestamp = (value: ExpiryValue): number =>
  value.day === null
    ? new Date(value.year, value.month, 0).getTime()
    : new Date(value.year, value.month - 1, value.day).getTime();

export const sameExpiryMonth = (left: ExpiryValue, right: ExpiryValue): boolean =>
  left.year === right.year && left.month === right.month;

export type ExpiryInput =
  | { readonly _tag: "Empty" }
  | { readonly _tag: "Valid"; readonly value: ExpiryValue; readonly expiresAt: number }
  | { readonly _tag: "Invalid" };

export const EXPIRY_INPUT_HINT = "MM/YY, DD/MM/YYYY, or YYYY-MM-DD";

const EMPTY_EXPIRY: ExpiryInput = { _tag: "Empty" };
const INVALID_EXPIRY: ExpiryInput = { _tag: "Invalid" };

export const readExpiryInput = (text: string): ExpiryInput => {
  if (!text.trim()) return EMPTY_EXPIRY;
  const date = text.replace(EXPIRY_PREFIX, "").trim();
  const mentions = findExpiryMentions(date);
  const [mention] = mentions;
  if (mention === undefined || mentions.length !== 1) return INVALID_EXPIRY;
  if (mention.index !== 0 || mention.raw.length !== date.length) return INVALID_EXPIRY;
  return { _tag: "Valid", value: mention.value, expiresAt: expiryTimestamp(mention.value) };
};
