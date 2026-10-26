import * as Predicate from "effect/Predicate";

import { parseUnitsPerPack, salvageUnitsPerPack } from "./pack-size";

type ModelScalar = string | number | boolean | null;

export const nullableText = (
  value: ModelScalar | undefined,
  maximumLength: number,
): string | null => {
  const text = Predicate.isString(value)
    ? value
    : value === undefined || value === null
      ? ""
      : String(value);
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized || /^(?:n\/?a|none|null|not found|unknown)$/i.test(normalized)) return null;
  return normalized.slice(0, maximumLength);
};

export const unitsPerPack = (
  value: ModelScalar | undefined,
  name: string | null,
): number | null => {
  if (!Predicate.isString(value) && !Predicate.isNumber(value)) return null;
  if (Predicate.isString(value) && !value.trim()) return null;
  const parsed = parseUnitsPerPack(value, Number.NaN);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10_000) return null;
  return salvageUnitsPerPack(name ?? "", parsed);
};
