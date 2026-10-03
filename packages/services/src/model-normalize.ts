import { parseUnitsPerPack, salvageUnitsPerPack } from "./invoice-extraction/pack-size";
import type { ModelScalar } from "./model-json";

export const isString = <Value>(value: Value): value is Value & string => typeof value === "string";

export const isNumber = <Value>(value: Value): value is Value & number => typeof value === "number";

export const nullableText = (
  value: ModelScalar | undefined,
  maximumLength: number,
): string | null => {
  const text = isString(value) ? value : value === undefined || value === null ? "" : String(value);
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized || /^(?:n\/?a|none|null|not found|unknown)$/i.test(normalized)) return null;
  return normalized.slice(0, maximumLength);
};

export const unitsPerPack = (
  value: ModelScalar | undefined,
  name: string | null,
): number | null => {
  if (!isString(value) && !isNumber(value)) return null;
  if (isString(value) && !value.trim()) return null;
  const parsed = parseUnitsPerPack(value, Number.NaN);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10_000) return null;
  return salvageUnitsPerPack(name ?? "", parsed);
};
